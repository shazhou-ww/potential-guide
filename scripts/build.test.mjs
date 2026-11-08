import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspace } from "./build.mjs";

for (const selected of [false, true]) {
  test(`filtered publishing preserves its dependency closure; environment selected=${selected}`, async () => {
    const calls = [];
    let fingerprints = 0;
    const filter = "--filter=@potential-guide/selected...";
    const code = await buildWorkspace(
      [filter],
      (command, args, options) => {
        assert.equal(command, "pnpm");
        calls.push({ args, env: options.env });
        if (args.includes("--dry=json"))
          return {
            status: 0,
            stdout: JSON.stringify({
              tasks: [
                { taskId: "@potential-guide/selected#build" },
                ...(selected ? [{ taskId: "@potential-guide/check-environment#build" }] : []),
              ],
            }),
          };
        return { status: 0 };
      },
      async () => {
        fingerprints++;
        return "raw-binary-input";
      },
    );
    assert.equal(code, 0);
    assert.equal(fingerprints, selected ? 1 : 0);
    assert.deepEqual(calls[1].args, ["exec", "turbo", "run", "build", filter]);
    assert.equal(calls.length, selected ? 3 : 2);
    if (selected) {
      assert.equal(calls[1].env.PGUIDE_ENVIRONMENT_BINARY_INPUTS, "raw-binary-input");
      assert.deepEqual(calls[2].args, [
        "exec",
        "turbo",
        "run",
        "verify",
        "--filter=@potential-guide/check-environment",
      ]);
    }
  });
}

test("failed builds cannot run acceptance or return a successful publishing build", async () => {
  const calls = [];
  assert.equal(
    await buildWorkspace(
      [],
      (_command, args) => {
        calls.push(args);
        return { status: 7 };
      },
      async () => "inputs",
    ),
    7,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    buildWorkspace(["--filter=bad"], () => ({ status: 1, stderr: "bad plan" })),
    /bad plan/,
  );
  for (const tasks of [[], [{}], [null]])
    await assert.rejects(
      buildWorkspace(["--filter=bad"], () => ({ status: 0, stdout: JSON.stringify({ tasks }) })),
      /Invalid filtered build plan/,
    );
});

test("full builds generate Probe example imports only after accepting Environment Checks", async () => {
  const calls = [];
  const code = await buildWorkspace(
    [],
    (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
    async () => "inputs",
  );
  assert.equal(code, 0);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ["exec", "turbo", "run", "build"]);
  assert.deepEqual(calls[1].args, [
    "exec",
    "turbo",
    "run",
    "verify",
    "--filter=@potential-guide/check-environment",
  ]);
  assert.equal(calls[2].command, process.execPath);
  assert.match(calls[2].args[0], /run-probe-objectives\.mjs$/);
  assert.equal(calls[2].args[1], "build");
});

test("Probe example preparation failures fail the full build explicitly", async () => {
  const failure = new Error("Pinned Check CID mismatch");
  for (const result of [{ status: 9 }, { error: failure }]) {
    const build = buildWorkspace(
      [],
      (command) => (command === process.execPath ? result : { status: 0 }),
      async () => "inputs",
    );
    if (result.error) await assert.rejects(build, (error) => error === failure);
    else assert.equal(await build, 9);
  }
});
