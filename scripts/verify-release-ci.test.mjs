import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { releaseCiJobName, verifyReleaseCi } from "./verify-release-ci.mjs";

const release = {
  repository: "potential-guide/fixture",
  sha: "a".repeat(40),
  token: "fixture-token",
};

function successfulRun() {
  return {
    id: 123,
    head_sha: release.sha,
    head_branch: "main",
    event: "push",
    path: ".github/workflows/ci.yaml",
    repository: { full_name: release.repository },
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/potential-guide/fixture/actions/runs/123",
    run_attempt: 1,
  };
}

function successfulVerification(run = successfulRun()) {
  return {
    name: releaseCiJobName,
    head_sha: run.head_sha,
    run_id: run.id,
    status: "completed",
    conclusion: "success",
    steps: [
      {
        name: "Confirm all release checks passed",
        status: "completed",
        conclusion: "success",
      },
    ],
  };
}

test("release CI queries the latest main push run for the exact SHA without filtering failures", async () => {
  const expected = successfulRun();
  let requests = 0;
  const result = await verifyReleaseCi(release, async (url, options) => {
    requests++;
    assert.equal(options.headers.authorization, `Bearer ${release.token}`);
    assert.ok(options.signal instanceof AbortSignal);
    if (requests === 1) {
      assert.equal(url.pathname, "/repos/potential-guide/fixture/actions/workflows/ci.yaml/runs");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        branch: "main",
        event: "push",
        head_sha: release.sha,
        per_page: "1",
      });
      return Response.json({ workflow_runs: [expected] });
    }
    assert.equal(url.pathname, "/repos/potential-guide/fixture/actions/runs/123/attempts/1/jobs");
    assert.equal(url.searchParams.get("per_page"), "100");
    return Response.json({ jobs: [successfulVerification()] });
  });
  assert.equal(requests, 2);
  assert.deepEqual(result, expected);
});

test("old green CI without the current release verification configuration is rejected", async () => {
  await assert.rejects(
    verifyReleaseCi(release, async (url) =>
      Response.json(
        url.pathname.endsWith("/jobs")
          ? {
              jobs: [
                { ...successfulVerification(), name: "Node.js 24.11.1" },
                { ...successfulVerification(), name: "Release verification (v0)" },
              ],
            }
          : { workflow_runs: [successfulRun()] },
      ),
    ),
    /Older CI configurations cannot authorize a release/,
  );
});

test("release verification must belong to this SHA and run, and must actually execute", async () => {
  for (const mismatch of [
    { head_sha: "b".repeat(40) },
    { run_id: 456 },
    { status: "in_progress" },
    { conclusion: "failure" },
    { conclusion: "skipped" },
    { steps: [] },
    { steps: [{ ...successfulVerification().steps[0], conclusion: "skipped" }] },
    { steps: [{ ...successfulVerification().steps[0], status: "in_progress" }] },
  ]) {
    await assert.rejects(
      verifyReleaseCi(release, async (url) =>
        Response.json(
          url.pathname.endsWith("/jobs")
            ? { jobs: [{ ...successfulVerification(), ...mismatch }] }
            : { workflow_runs: [successfulRun()] },
        ),
      ),
      /Release verification must|verification step must run successfully/,
    );
  }
});

test("the verification job is read from the selected run attempt, never an old attempt", async () => {
  const expected = { ...successfulRun(), run_attempt: 2 };
  await verifyReleaseCi(release, async (url) => {
    if (url.pathname.endsWith("/jobs")) {
      assert.ok(url.pathname.endsWith("/runs/123/attempts/2/jobs"));
      return Response.json({ jobs: [successfulVerification()] });
    }
    return Response.json({ workflow_runs: [expected] });
  });
});

test("missing, pending and unsuccessful CI cannot authorize a release", async () => {
  for (const [status, conclusion] of [
    ["queued", null],
    ["in_progress", null],
    ["completed", "failure"],
    ["completed", "cancelled"],
    ["completed", "skipped"],
    ["completed", "neutral"],
    ["completed", "timed_out"],
    ["completed", "action_required"],
  ]) {
    await assert.rejects(
      verifyReleaseCi(release, async () =>
        Response.json({ workflow_runs: [{ ...successfulRun(), status, conclusion }] }),
      ),
      /Wait for it to complete|A successful main CI is required/,
    );
  }
  await assert.rejects(
    verifyReleaseCi(release, async () => Response.json({ workflow_runs: [] })),
    /No main push CI exists/,
  );
});

test("a newer failed run is not replaced by an older successful run", async () => {
  await assert.rejects(
    verifyReleaseCi(release, async () =>
      Response.json({
        workflow_runs: [{ ...successfulRun(), conclusion: "failure" }, successfulRun()],
      }),
    ),
    /A successful main CI is required/,
  );
});

test("results for other commits, branches, events, workflows or repositories are rejected", async () => {
  for (const mismatch of [
    { head_sha: "b".repeat(40) },
    { head_branch: "feature" },
    { event: "pull_request" },
    { event: "workflow_dispatch" },
    { path: ".github/workflows/other.yaml" },
    { repository: { full_name: "other/fixture" } },
  ]) {
    await assert.rejects(
      verifyReleaseCi(release, async () =>
        Response.json({ workflow_runs: [{ ...successfulRun(), ...mismatch }] }),
      ),
      /CI must|Only main push|Unexpected CI/,
    );
  }
});

test("API errors, malformed responses and invalid inputs fail closed", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    await assert.rejects(
      verifyReleaseCi(release, async () => new Response(null, { status })),
      new RegExp(`HTTP ${status}`),
    );
  }
  await assert.rejects(
    verifyReleaseCi(release, async () => Response.json({})),
    /Invalid GitHub workflow runs response/,
  );
  await assert.rejects(
    verifyReleaseCi(release, async () => {
      throw new Error("Network unavailable");
    }),
    /Network unavailable/,
  );
  for (const invalid of [{ repository: "" }, { sha: "main" }, { token: "" }]) {
    await assert.rejects(
      verifyReleaseCi({ ...release, ...invalid }, async () => assert.fail("Must not request.")),
      /is required/,
    );
  }
  for (const invalid of [{ id: undefined }, { run_attempt: 0 }]) {
    await assert.rejects(
      verifyReleaseCi(release, async () =>
        Response.json({ workflow_runs: [{ ...successfulRun(), ...invalid }] }),
      ),
      /Invalid CI run/,
    );
  }
  for (const response of [
    new Response(null, { status: 403 }),
    Response.json({}),
    Response.json({ jobs: [successfulVerification(), successfulVerification()] }),
  ]) {
    await assert.rejects(
      verifyReleaseCi(release, async (url) =>
        url.pathname.endsWith("/jobs")
          ? response
          : Response.json({ workflow_runs: [successfulRun()] }),
      ),
      /HTTP 403|Invalid GitHub workflow jobs response|exactly one/,
    );
  }
});

test("workflows validate consumers once on main and gate scoped builds but not recovery", async () => {
  const [ci, publish] = await Promise.all(
    ["ci.yaml", "publish-npm.yaml"].map((file) =>
      readFile(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8"),
    ),
  );
  const consumers = ci.match(/ {2}package-consumers:\r?\n([\s\S]*?)^ {2}deployment-cli:/m)?.[1];
  assert.ok(consumers);
  assert.ok(
    consumers.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"),
  );
  assert.ok(consumers.includes("run: pnpm consumers:check"));
  assert.ok(ci.includes("run: pnpm check"));
  const verification = ci.match(/ {2}release-verification:\r?\n([\s\S]*)$/m)?.[1];
  assert.ok(verification);
  assert.ok(verification.includes(`name: ${releaseCiJobName}`));
  assert.ok(verification.includes("needs: [check, package-consumers, deployment-cli]"));
  assert.ok(
    verification.includes(
      "if: always() && github.event_name == 'push' && github.ref == 'refs/heads/main'",
    ),
  );
  for (const [variable, job] of [
    ["CHECK_RESULT", "check"],
    ["CONSUMERS_RESULT", "package-consumers"],
    ["DEPLOYMENT_RESULT", "deployment-cli"],
  ]) {
    assert.ok(verification.includes(`${variable}: \${{ needs.${job}.result }}`));
    assert.ok(verification.includes(`"$${variable}" != success`));
  }
  assert.ok(verification.includes("name: Confirm all release checks passed"));
  assert.ok(verification.includes("exit 1"));
  assert.ok(publish.includes("actions: read"));
  assert.ok(!publish.includes("run: pnpm check"));
  assert.ok(!publish.includes("run: pnpm consumers:check"));
  const steps = publish.split(/^\s{6}- name: /m).slice(1);
  const conditionalSteps = [
    "Install the trusted publishing client",
    "Install dependencies",
    "Verify successful main CI for release commit",
    "Build package and workspace dependencies",
  ];
  for (const name of conditionalSteps) {
    const step = steps.find((step) => step.split(/\r?\n/, 1)[0] === name);
    assert.ok(step, `Missing step: ${name}`);
    assert.ok(
      step.includes("if: github.event_name == 'push' || inputs.mode != 'verify-published'"),
      `${name} must not run in recovery mode.`,
    );
  }
  assert.ok(publish.includes("run: node scripts/verify-release-ci.mjs"));
  const build = publish.match(/run: pnpm exec turbo run build --filter="\$\{PACKAGE_NAME\}\.\.\."/);
  assert.ok(build);
  assert.ok(publish.indexOf("run: node scripts/verify-release-ci.mjs") < build.index);
});
