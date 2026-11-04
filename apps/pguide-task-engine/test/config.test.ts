import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { userConfigPath } from "@potential-guide/cli-core";
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
    resolveConfig(parseArguments(["--cwd", directory, ...args]));
  const initial = await load();
  assert.equal(initial.port, 3000);
  assert.equal(initial.database, join(directory, "tasks.sqlite"));
  assert.equal(initial.ipfsTransport, "rpc");
  assert.equal(initial.ipfsGatewayUrl, undefined);
  assert.equal(
    (await load(["--ipfs-gateway-url", "https://example.test/base"])).ipfsTransport,
    "rpc",
  );
  await assert.rejects(load(["--ipfs-transport", "gateway"]), /requires ipfsGatewayUrl/);
  await writeFile(
    userPath,
    JSON.stringify({
      "task-engine.ipfsTransport": "gateway",
      "task-engine.ipfsGatewayUrl": "https://user.test/base",
    }),
  );
  assert.equal((await load()).ipfsGatewayUrl, "https://user.test/base");
  await writeFile(
    config,
    JSON.stringify({
      ipfsTransport: "rpc",
      ipfsGatewayUrl: "https://file.test/base",
    }),
  );
  assert.equal((await load(["--config", config])).ipfsTransport, "rpc");
  const gateway = await load([
    "--config",
    config,
    "--ipfs-transport",
    "gateway",
    "--ipfs-gateway-url",
    "https://cli.test/base",
  ]);
  assert.equal(gateway.ipfsTransport, "gateway");
  assert.equal(gateway.ipfsGatewayUrl, "https://cli.test/base");
  for (const bad of [
    { ipfsTransport: "auto" },
    { ipfsTransport: null },
    { ipfsGatewayUrl: 1 },
    { ipfsGatewayUrl: "file:///gateway" },
    { ipfsGatewayUrl: "https://u:p@example.test" },
    { ipfsGatewayUrl: "https://example.test/?secret=1" },
    { ipfsGatewayUrl: "https://example.test/#fragment" },
    { ipfsGatewayUrl: "https://example.test/?" },
    { ipfsGatewayUrl: "https://example.test/#" },
  ]) {
    const override = [
      "--config",
      config,
      "--ipfs-transport",
      "gateway",
      "--ipfs-gateway-url",
      "https://valid.test",
    ];
    await writeFile(
      userPath,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(bad).map(([key, value]) => [`task-engine.${key}`, value]),
        ),
      ),
    );
    await assert.rejects(load(override));
    await writeFile(userPath, "{}");
    await writeFile(config, JSON.stringify(bad));
    await assert.rejects(load(override));
  }
  await writeFile(userPath, '{"task-engine.ipfsTransport":"invalid"}');
  assert.equal((await load(["--no-global-config"])).ipfsTransport, "rpc");
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
  await assert.rejects(load(["--config", config, "--port", "0"]));
  assert.equal((await load(["--no-global-config", "--port", "0"])).port, 0);
  await writeFile(userPath, "{ malformed");
  await assert.rejects(load());
  assert.equal((await load(["--no-global-config"])).port, 3000);
  await writeFile(userPath, '{"task-engine.unknown":true}');
  await assert.rejects(load());
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
