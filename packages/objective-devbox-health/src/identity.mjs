import { userInfo } from "node:os";
import { envelope, issue } from "./contract.mjs";
import { detectedEnvironment, directoryProblems, execute } from "./execution.mjs";
export function sudoUnrestricted(output) {
  const start = output.search(/^\s*\([^)\n]+\)\s+/m);
  if (start === -1) return false;
  const grants = output.slice(start);
  return (
    grants
      .split("\n")
      .some((line) => /^\s*\(ALL(?:\s*:\s*ALL)?\)\s+NOPASSWD:\s*ALL\s*$/.test(line)) &&
    !/(?:^|\s|,)![^\s]/m.test(grants)
  );
}
export async function identity(subject, context) {
  const actual = userInfo();
  const problems = [];
  if (
    actual.uid === 0 ||
    actual.username !== subject.user ||
    actual.homedir !== subject.home ||
    process.env.HOME !== subject.home
  )
    problems.push(
      issue("identity-mismatch", {
        expected: { user: subject.user, home: subject.home, nonroot: true },
        actual: {
          user: actual.username,
          home: actual.homedir,
          HOME: process.env.HOME ?? "",
          uid: actual.uid,
        },
        recovery:
          "Run as the declared non-root account with its HOME; do not hide a root invocation.",
      }),
    );
  const environment = await detectedEnvironment();
  if (environment !== subject.environment)
    problems.push(
      issue("environment-mismatch", { expected: subject.environment, actual: environment }),
    );
  problems.push(...(await directoryProblems(subject)));
  const sudo = await execute("sudo", ["-n", "-l"], context);
  const unrestricted = sudoUnrestricted(sudo.stdout);
  if (sudo.code !== 0 || !unrestricted)
    problems.push(
      issue("sudo-unavailable", {
        expected: "(ALL : ALL) NOPASSWD: ALL from sudo -n -l",
        actual: sudo.missing
          ? "sudo missing"
          : `exit ${sudo.code}; unrestricted grant=${unrestricted}`,
        recovery:
          "Have an administrator explicitly grant this trusted account unrestricted noninteractive sudo.",
      }),
    );
  return envelope(problems);
}
