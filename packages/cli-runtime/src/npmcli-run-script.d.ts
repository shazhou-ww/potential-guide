declare module "@npmcli/run-script" {
  export default function runScript(options: {
    event: string;
    path: string;
    stdio: "pipe";
    env: Readonly<Record<string, string>>;
  }): Promise<unknown>;
}
