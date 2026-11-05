import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const releaseCiJobName = "Release verification (v1)";

export async function verifyReleaseCi({ repository, sha, token }, request = fetch) {
  assert.match(repository ?? "", /^[\w.-]+\/[\w.-]+$/, "A GitHub repository is required.");
  assert.match(sha ?? "", /^[a-f0-9]{40}$/, "The exact release commit SHA is required.");
  assert.ok(token, "A GitHub token with actions:read permission is required.");
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/ci.yaml/runs`);
  url.search = new URLSearchParams({
    branch: "main",
    event: "push",
    head_sha: sha,
    per_page: "1",
  }).toString();
  const options = {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(15_000),
  };
  const response = await request(url, options);
  assert.ok(response.ok, `Could not read release CI results: HTTP ${response.status}.`);
  const { workflow_runs: runs } = await response.json();
  assert.ok(Array.isArray(runs), "Invalid GitHub workflow runs response.");
  const run = runs[0];
  assert.ok(run, `No main push CI exists for ${sha}. Run the complete main CI before releasing.`);
  assert.equal(run.head_sha, sha, "CI must validate the exact release commit.");
  assert.equal(run.head_branch, "main", "CI must run on main.");
  assert.equal(run.event, "push", "Only main push CI can authorize a release.");
  assert.equal(run.path, ".github/workflows/ci.yaml", "Unexpected CI workflow.");
  assert.equal(run.repository?.full_name, repository, "CI must belong to this repository.");
  assert.equal(
    run.status,
    "completed",
    `CI for ${sha} is ${run.status}. Wait for it to complete before releasing.`,
  );
  assert.equal(
    run.conclusion,
    "success",
    `CI for ${sha} concluded ${run.conclusion}. A successful main CI is required.`,
  );
  assert.ok(Number.isSafeInteger(run.id) && run.id > 0, "Invalid CI run ID.");
  assert.ok(
    Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0,
    "Invalid CI run attempt.",
  );
  const jobsUrl = new URL(
    `https://api.github.com/repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
  );
  jobsUrl.searchParams.set("per_page", "100");
  const jobsResponse = await request(jobsUrl, {
    ...options,
    signal: AbortSignal.timeout(15_000),
  });
  assert.ok(jobsResponse.ok, `Could not read release CI jobs: HTTP ${jobsResponse.status}.`);
  const { jobs } = await jobsResponse.json();
  assert.ok(Array.isArray(jobs), "Invalid GitHub workflow jobs response.");
  const verificationJobs = jobs.filter((job) => job.name === releaseCiJobName);
  assert.equal(
    verificationJobs.length,
    1,
    `CI must include exactly one ${releaseCiJobName} job. Older CI configurations cannot authorize a release.`,
  );
  const verification = verificationJobs[0];
  assert.equal(verification.head_sha, sha, "Release verification must match the source commit.");
  assert.equal(verification.run_id, run.id, "Release verification must belong to this CI run.");
  assert.equal(verification.status, "completed", "Release verification must be completed.");
  assert.equal(verification.conclusion, "success", "Release verification must succeed.");
  assert.ok(
    verification.steps?.some(
      (step) =>
        step.name === "Confirm all release checks passed" &&
        step.status === "completed" &&
        step.conclusion === "success",
    ),
    "The required release verification step must run successfully, not be skipped.",
  );
  return run;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const run = await verifyReleaseCi({
    repository: process.env.GITHUB_REPOSITORY,
    sha,
    token: process.env.GITHUB_TOKEN,
  });
  const receipt = {
    commit: sha,
    workflow: run.path,
    verification: releaseCiJobName,
    ciRun: run.html_url,
    attempt: run.run_attempt,
  };
  console.log(JSON.stringify(receipt, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Reused release CI\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n`,
    );
  }
}
