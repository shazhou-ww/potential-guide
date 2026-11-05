import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { settingsPackagesPath, userConfigPath } from "@potential-guide/cli-core";
import { parseArguments, resolveConfig } from "../src/config.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
test("four layers, whole settings, paths, isolation and validation", async (t) => {
  await mkdir(join(root, ".cache"), { recursive: true });
  const directory = await mkdtemp(join(root, ".cache", "service-config-"));
  const previous = { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.APPDATA = join(directory, "user");
  process.env.XDG_CONFIG_HOME = join(directory, "user");
  t.after(async () => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    await rm(directory, { recursive: true, force: true });
  });
  const userPath = userConfigPath();
  await mkdir(dirname(userPath), { recursive: true });
  await mkdir(join(directory, "files"));
  await mkdir(join(directory, ".pguide"));
  await writeFile(
    join(directory, ".pguide", "config.jsonc"),
    '{"task-engine.port":"invalid project value"}',
  );
  const config = join(directory, "files", "server.yaml");
  const load = (args: string[] = []) =>
    resolveConfig(
      parseArguments(["--cwd", directory, "--ipfs-gateway-url", "https://default.test", ...args]),
    );
  const missing = () => resolveConfig(parseArguments(["--cwd", directory]));
  const warnings = t.mock.method(console, "error", () => {});
  const ignoredUser = async (args: string[] = []) => {
    const before = warnings.mock.callCount();
    const result = await load(args);
    assert.equal(warnings.mock.callCount(), before + 1);
    const message = String(warnings.mock.calls.at(-1)?.arguments[0]);
    assert.match(message, /Warning:.*ignoring the entire global configuration/);
    assert.doesNotMatch(message, /password@example|SECRET_CONFIG/);
    return result;
  };
  await assert.rejects(missing(), /requires an explicit ipfsGatewayUrl/);
  const initial = await load();
  assert.equal(initial.port, 3000);
  assert.equal(initial.database, join(directory, "tasks.sqlite"));
  assert.equal(initial.ipfsGatewayUrl, "https://default.test/");
  await writeFile(
    userPath,
    JSON.stringify({
      "task-engine.ipfsGatewayUrl": "https://user.test/base",
    }),
  );
  assert.equal((await missing()).ipfsGatewayUrl, "https://user.test/base");
  await writeFile(
    config,
    JSON.stringify({
      ipfsGatewayUrl: "https://file.test/base",
    }),
  );
  assert.equal(
    (await resolveConfig(parseArguments(["--cwd", directory, "--config", config]))).ipfsGatewayUrl,
    "https://file.test/base",
  );
  const gateway = await resolveConfig(
    parseArguments([
      "--cwd",
      directory,
      "--config",
      config,
      "--ipfs-gateway-url",
      "https://cli.test/base",
    ]),
  );
  assert.equal(gateway.ipfsGatewayUrl, "https://cli.test/base");
  for (const bad of [
    { ipfsGatewayUrl: 1 },
    { ipfsGatewayUrl: "file:///gateway" },
    { ipfsGatewayUrl: "https://u:p@example.test" },
    { ipfsGatewayUrl: "https://example.test/?secret=1" },
    { ipfsGatewayUrl: "https://example.test/#fragment" },
    { ipfsGatewayUrl: "https://example.test/?" },
    { ipfsGatewayUrl: "https://example.test/#" },
  ]) {
    const override = ["--config", config];
    await writeFile(config, "{}");
    await writeFile(
      userPath,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(bad).map(([key, value]) => [`task-engine.${key}`, value]),
        ),
      ),
    );
    assert.equal((await ignoredUser(override)).port, 3000);
    await writeFile(userPath, "{}");
    await writeFile(config, JSON.stringify(bad));
    await assert.rejects(load(override));
  }
  for (const key of ["ipfsTransport", "ipfsRpcUrl"]) {
    await writeFile(config, "{}");
    for (const value of [
      "rpc",
      "gateway",
      "auto",
      "http://127.0.0.1:5001",
      "",
      null,
      false,
      1,
      {},
    ]) {
      await writeFile(userPath, JSON.stringify({ [`task-engine.${key}`]: value }));
      assert.equal((await ignoredUser()).port, 3000);
      assert.equal((await load(["--no-global-config"])).ipfsGatewayUrl, "https://default.test/");
      await writeFile(userPath, "{}");
      await writeFile(config, JSON.stringify({ [key]: value }));
      await assert.rejects(load(["--config", config]), /retired.*service file/);
    }
  }
  for (const flag of ["--ipfs-transport", "--ipfs-rpc-url"]) {
    for (const value of ["rpc", "gateway", "bad", ""])
      assert.throws(() => parseArguments([`${flag}=${value}`]), /retired.*--ipfs-gateway-url/);
    assert.throws(() => parseArguments([flag]), /retired/);
  }
  const registered = join(directory, "old-settings");
  await mkdir(registered);
  await writeFile(
    join(registered, "package.json"),
    JSON.stringify({
      name: "@potential-guide/pguide-task-engine",
      pguide: { settings: "./settings.json" },
    }),
  );
  await writeFile(
    join(registered, "settings.json"),
    JSON.stringify({
      schemaVersion: 1,
      namespace: "task-engine",
      settings: {
        "task-engine.ipfsRpcUrl": { description: "Old RPC", schema: { type: "string" } },
      },
    }),
  );
  await writeFile(
    settingsPackagesPath(),
    JSON.stringify({
      schemaVersion: 1,
      packages: [
        { name: "@potential-guide/pguide-task-engine", root: registered, namespace: "task-engine" },
      ],
    }),
  );
  await writeFile(userPath, '{"task-engine.ipfsRpcUrl":false}');
  assert.equal((await ignoredUser()).port, 3000);
  assert.equal((await load(["--no-global-config"])).port, 3000);
  await writeFile(userPath, "{}");
  assert.equal((await ignoredUser()).port, 3000);
  await rm(settingsPackagesPath());
  await writeFile(
    userPath,
    JSON.stringify({
      "task-engine.port": 1234,
      "task-engine.database": "user.sqlite",
      "task-engine.uiOptions": { host: "localhost", port: 4321, favoritesFile: "user.json" },
      "other-package.anything": { legal: true },
    }),
  );
  await writeFile(
    config,
    "port: 2345\nuiOptions: {host: '::1', port: 0, favoritesFile: file.json}\n",
  );
  const user = await load();
  assert.equal(user.port, 1234);
  assert.equal(user.database, join(dirname(userPath), "user.sqlite"));
  const file = await load(["--config", "files/server.yaml"]);
  assert.equal(file.port, 2345);
  assert.equal(file.database, user.database);
  assert.deepEqual(file.uiOptions, {
    host: "::1",
    port: 0,
    favoritesFile: join(dirname(config), "file.json"),
  });
  const cli = await load([
    "--config",
    config,
    "--port",
    "0",
    "--host",
    "localhost",
    "--database",
    "cli.sqlite",
    "--no-ui",
  ]);
  assert.equal(cli.port, 0);
  assert.equal(cli.host, "127.0.0.1");
  assert.equal(cli.database, join(directory, "cli.sqlite"));
  assert.equal(cli.ui, false);
  await writeFile(config, "database: file.sqlite\n");
  assert.equal((await load(["--config", config])).database, join(dirname(config), "file.sqlite"));
  for (const bad of [
    { port: "invalid" },
    { host: "0.0.0.0" },
    { host: "192.168.1.1" },
    { ipfsEndpoint: "http://localhost" },
    { ipfs: { rpcUrl: "http://localhost" } },
    { ipfsRpcUrl: "https://secret:password@example.test" },
    { ipfsRpcUrl: "file:///kubo" },
    { uiOptions: { port: 0 } },
    { scope: "" },
    { database: "" },
    { ui: "false" },
  ]) {
    await writeFile(config, JSON.stringify(bad));
    await assert.rejects(
      load(["--config", config, "--port", "0", "--host", "127.0.0.1", "--no-ui"]),
    );
  }
  await writeFile(config, "{}");
  await writeFile(userPath, '{"task-engine.port":"invalid"}');
  assert.equal((await ignoredUser(["--config", config, "--port", "0"])).port, 0);
  assert.equal((await load(["--no-global-config", "--port", "0"])).port, 0);
  await writeFile(userPath, "{ malformed");
  assert.equal((await ignoredUser()).port, 3000);
  assert.equal((await load(["--no-global-config"])).port, 3000);
  await writeFile(userPath, '{"task-engine.unknown":true}');
  assert.equal((await ignoredUser()).port, 3000);
  await writeFile(userPath, '{"task-engine.port":1234,"task-engine.unknown":"SECRET_CONFIG"}');
  assert.equal((await ignoredUser()).port, 3000);
  await writeFile(userPath, '{"task-engine.port":1234}');
  await writeFile(settingsPackagesPath(), "{malformed SECRET_CONFIG");
  assert.equal((await ignoredUser()).port, 3000);
  await rm(settingsPackagesPath());
  await writeFile(userPath, "{}");
  await assert.rejects(load(["--config", "missing.json"]));
  await writeFile(config, "port: 2\nport: 3");
  await assert.rejects(load(["--config", config]));
  await writeFile(config, "port: !executable 2");
  await assert.rejects(load(["--config", config]));
  const module = join(directory, "unsafe.mjs");
  await writeFile(module, 'throw new Error("EXECUTED_MODULE");');
  await assert.rejects(load(["--config", module]), /Executable .mjs configs are retired/);
  await assert.rejects(load(["--ui-options", '{"port":0}']));
  assert.throws(() => parseArguments(["--port", "0", "--port", "1"]), /Repeated/);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown/);
  assert.equal(resolve(initial.database), initial.database);
});
