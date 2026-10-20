import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { envelope, issue } from "./contract.mjs";
import { directoryProblems, execute } from "./execution.mjs";
export function parseToolVersion(output) {
  return /(?:^|\s)v?(\d+\.\d+(?:\.\d+)*)(?:\b|$)/m.exec(output)?.[1];
}
export function compareVersions(actual, expected) {
  const a = actual.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  const b = expected.split(".").map((part) => part.replace(/^0+(?=\d)/, ""));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const first = a[i] ?? "0";
    const second = b[i] ?? "0";
    if (first.length !== second.length) return Math.sign(first.length - second.length);
    if (first !== second) return first > second ? 1 : -1;
  }
  return 0;
}
export async function toolchains(subject, context) {
  const problems = await directoryProblems(subject);
  if (problems.length) return envelope(problems);
  const tools = [
    "git",
    ...(subject.stacks.includes("typescript") ? ["node", "npm", "tsc"] : []),
    ...(subject.stacks.includes("python") ? ["python3"] : []),
    ...(subject.stacks.includes("cpp") ? ["c++", "cmake", "ninja"] : []),
    ...(subject.stacks.includes("rust") ? ["rustup", "rustc", "cargo"] : []),
  ];
  const unavailable = new Set();
  for (const tool of tools) {
    const result = await execute(tool, ["--version"], context);
    if (result.missing) {
      unavailable.add(tool);
      problems.push(
        issue("tool-missing", {
          tool,
          expected: subject.minimumVersions[tool],
          actual: "ENOENT",
          recovery: "Install the declared tool explicitly outside this check.",
        }),
      );
      continue;
    }
    const actual = parseToolVersion(result.stdout + result.stderr);
    context.evidence?.fact("version.observed", {
      tool,
      actual: actual ?? null,
      expected: subject.minimumVersions[tool],
      code: result.code,
    });
    if (
      result.code !== 0 ||
      !actual ||
      compareVersions(actual, subject.minimumVersions[tool]) < 0
    ) {
      unavailable.add(tool);
      problems.push(
        issue("tool-version", {
          tool,
          expected: subject.minimumVersions[tool],
          actual: actual ?? "unparseable",
          code: result.code,
          recovery: "Select an installed supported toolchain; no automatic download is attempted.",
        }),
      );
    }
  }
  const scratch = await mkdtemp(join(subject.scratchDirectory, "pguide-health-"));
  const expected = "pguide-health-ok";
  const run = async (stack, command, args, output) => {
    const result = await execute(command, args, { ...context, cwd: scratch, timeout: 10000 });
    context.evidence?.fact("assertion.result", {
      stack,
      code: result.code,
      expected: output ?? "exit 0",
      matches: result.code === 0 && (output === undefined || result.stdout.trim() === output),
    });
    if (result.code !== 0 || (output !== undefined && result.stdout.trim() !== output)) {
      problems.push(
        issue("toolchain-failed", {
          stack,
          tool: command,
          expected: output ?? "exit 0",
          actual: {
            code: result.code,
            stdout: result.stdout.slice(0, 4096),
            stderr: result.stderr.slice(0, 4096),
          },
          recovery:
            "Repair this compiler, linker, runtime or offline standard library; preserve workspace data.",
        }),
      );
      return false;
    }
    return true;
  };
  try {
    if (
      subject.stacks.includes("typescript") &&
      !["node", "npm", "tsc"].some((t) => unavailable.has(t))
    ) {
      await writeFile(
        join(scratch, "proof.ts"),
        `const value: string = "${expected}"; console.log(value);\n`,
      );
      if (
        await run("typescript", "tsc", [
          "--strict",
          "--target",
          "ES2022",
          "--module",
          "commonjs",
          "--outDir",
          "ts-out",
          "proof.ts",
        ])
      )
        await run("typescript", "node", [join(scratch, "ts-out", "proof.js")], expected);
    }
    if (subject.stacks.includes("python") && !unavailable.has("python3")) {
      if (await run("python", "python3", ["-m", "venv", join(scratch, "venv")]))
        await run(
          "python",
          join(scratch, "venv", "bin", "python"),
          ["-c", `import sys; assert sys.prefix != sys.base_prefix; print("${expected}")`],
          expected,
        );
    }
    if (
      subject.stacks.includes("cpp") &&
      !["c++", "cmake", "ninja"].some((t) => unavailable.has(t))
    ) {
      await writeFile(
        join(scratch, "proof.cpp"),
        `#include <iostream>\nint main(){std::cout<<"${expected}\\n";}\n`,
      );
      await writeFile(
        join(scratch, "CMakeLists.txt"),
        "cmake_minimum_required(VERSION 3.20)\nproject(health LANGUAGES CXX)\nadd_executable(proof proof.cpp)\ntarget_compile_features(proof PRIVATE cxx_std_17)\n",
      );
      if (
        (await run("cpp", "cmake", [
          "-S",
          scratch,
          "-B",
          join(scratch, "cpp-out"),
          "-G",
          "Ninja",
          "-DCMAKE_CXX_COMPILER=c++",
        ])) &&
        (await run("cpp", "cmake", ["--build", join(scratch, "cpp-out")]))
      )
        await run("cpp", join(scratch, "cpp-out", "proof"), [], expected);
    }
    if (
      subject.stacks.includes("rust") &&
      !["rustup", "rustc", "cargo"].some((t) => unavailable.has(t))
    ) {
      await writeFile(join(scratch, "proof.rs"), `fn main(){println!("${expected}");}\n`);
      await writeFile(
        join(scratch, "Cargo.toml"),
        '[package]\nname="pguide-health-proof"\nversion="0.0.0"\nedition="2021"\n[[bin]]\nname="proof"\npath="proof.rs"\n[workspace]\n',
      );
      if (
        await run("rust", "cargo", [
          "build",
          "--offline",
          "--manifest-path",
          join(scratch, "Cargo.toml"),
          "--target-dir",
          join(scratch, "rust-out"),
        ])
      )
        await run("rust", join(scratch, "rust-out", "debug", "proof"), [], expected);
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  return envelope(
    problems,
    subject.stacks.length
      ? []
      : ["Stack proofs: not applicable (no declared stacks); Git still required"],
  );
}
