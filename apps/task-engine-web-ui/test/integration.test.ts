import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import {
  type HistoryPage,
  isTimedOut,
  type Observation,
  TaskError,
  type TaskPage,
  type TaskSnapshot,
  type TaskTypeDiscovery,
} from "@potential-guide/task-protocol";
import { fixtureTypes } from "../fixture/types.js";
import {
  ApiError,
  consumeSse,
  Directory,
  type Entry,
  EventWindow,
  newIdentity,
  originalParameters,
  SubmissionBar,
} from "../src/model.js";
import { type Endpoint, type Favorite, startUiServer } from "../src/server.js";

async function setup(t: TestContext, queryLifetimeMs = 60_000, retentionMs = 86_400_000) {
  const root = resolve(".cache", `ui-test-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const token = randomBytes(32).toString("hex");
  const env = `UI_TEST_${randomBytes(8).toString("hex")}`;
  process.env[env] = token;
  process.env[`${env}_LIST`] = `${token}-list`;
  process.env[`${env}_OTHER`] = `${token}-other`;
  const resources = fixtureTypes();
  const store = new MemoryStore();
  const backend = await startTaskServer({
    port: 0,
    store,
    types: resources.types,
    currentVersions: { echo: "1", survey: "1" },
    authorize: (caller, operation, scope) =>
      caller.scope === scope && (caller.subject !== "list" || operation === "list"),
    resolveCaller(request) {
      const bearer = request.headers.get("authorization");
      if (bearer === `Bearer ${token}`) return { scope: "one", subject: "full" };
      if (bearer === `Bearer ${token}-list`) return { scope: "one", subject: "list" };
      if (bearer === `Bearer ${token}-other`) return { scope: "two", subject: "full" };
      throw new TaskError("unauthenticated", "Fixture authentication required.");
    },
    limits: { maxConcurrent: 3, queryLifetimeMs, retentionMs, pageSize: 2 },
    http: { pollMs: 20 },
    closeResources: resources.close,
  });
  const config = {
    port: 0,
    favoritesFile: resolve(root, "favorites.json"),
    endpoints: [
      { id: "full", label: "完整权限", url: backend.url, binding: "test-1", bearerEnv: env },
      {
        id: "list",
        label: "目录权限",
        url: backend.url,
        binding: "test-1",
        bearerEnv: `${env}_LIST`,
      },
      {
        id: "other",
        label: "另一 scope",
        url: backend.url,
        binding: "test-1",
        bearerEnv: `${env}_OTHER`,
      },
    ],
  };
  let ui = await startUiServer(config);
  let bootstrap = (await fetch(`${ui.url}/api/bootstrap`).then((response) => response.json())) as {
    csrf: string;
    endpoints: Endpoint[];
  };
  const endpoint = (id = "full") => bootstrap.endpoints.find((item) => item.id === id)!;
  const local = async (
    path: string,
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    fetch(`${ui.url}${path}`, {
      method,
      headers: {
        Origin: ui.url,
        "X-UI-Token": bootstrap.csrf,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const request = async <T>(
    path: string,
    options: {
      id?: string;
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> => {
    const target = endpoint(options.id);
    const response = await local(
      `/api/endpoints/${target.id}${path}`,
      options.method ?? "GET",
      options.body,
      {
        "X-Endpoint-Binding": target.binding,
        ...options.headers,
      },
    );
    const value = await response.json();
    if (!response.ok) throw new ApiError(response.status, value.error.code, value.error.message);
    return value as T;
  };
  const discovery = await request<TaskTypeDiscovery[]>("/task-types");
  const send = (entry: Entry) =>
    request<TaskSnapshot>("/tasks", {
      id: entry.endpoint.id,
      method: "POST",
      body: entry.parameters,
      headers: { "Idempotency-Key": entry.id, "If-Match": `"${entry.revision}"` },
    });
  const bar = new SubmissionBar(send);
  const submit = (text: string, extra: Record<string, unknown> = {}) =>
    bar.quick(
      endpoint(),
      { type: "echo", timeoutMs: 5000, text, durationMs: 50, ...extra },
      discovery[0]!.revision,
    );
  t.after(async () => {
    try {
      await ui.close();
    } finally {
      await backend.close();
    }
    for (const key of [env, `${env}_LIST`, `${env}_OTHER`]) delete process.env[key];
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    token,
    backend,
    config,
    endpoint,
    local,
    request,
    discovery,
    bar,
    submit,
    send,
    get url() {
      return ui.url;
    },
    get csrf() {
      return bootstrap.csrf;
    },
    async restart(rebind = false) {
      await ui.close();
      if (rebind) config.endpoints[0]!.binding = "test-2";
      ui = await startUiServer(config);
      bootstrap = await fetch(`${ui.url}/api/bootstrap`).then((response) => response.json());
    },
    closeUi: () => ui.close(),
  };
}
async function until<T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
  timeout = 4000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected fixture condition did not occur.");
}
function revision(types: TaskTypeDiscovery[], type: string): string {
  return types.find((entry) => entry.type === type)!.revision;
}

test("real HTTP discovery, two schemas, quoted guard, immutable input and original identity retries", async (t) => {
  const h = await setup(t);
  assert.deepEqual(
    h.discovery.map((type) => type.type),
    ["echo", "survey"],
  );
  const parameters = {
    type: "survey",
    timeoutMs: 5000,
    subject: { name: "<script>alert(1)</script>", active: false },
    scores: [1, 2.5],
    mode: "brief",
  };
  const entry = await h.bar.quick(h.endpoint(), parameters, revision(h.discovery, "survey"));
  assert.equal(entry.state, "accepted");
  assert.deepEqual(originalParameters(await h.request(`/requests/${entry.id}`)), parameters);
  const accepted = await h.send(entry);
  assert.equal(accepted.taskId, entry.snapshot!.taskId);
  await assert.rejects(
    () =>
      h.request("/tasks", {
        method: "POST",
        body: parameters,
        headers: { "Idempotency-Key": newIdentity(), "If-Match": `"${"0".repeat(64)}"` },
      }),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 412 &&
      error.code === "contract_revision_mismatch",
  );
  await assert.rejects(
    () =>
      h.request("/tasks", {
        method: "POST",
        body: parameters,
        headers: { "Idempotency-Key": newIdentity(), "If-Match": revision(h.discovery, "survey") },
      }),
    /identity_required/,
  );
  const invalid = await h.bar.quick(
    h.endpoint(),
    { ...parameters, subject: { name: "x", active: "false" } },
    revision(h.discovery, "survey"),
  );
  assert.equal(invalid.state, "failed");
  assert.equal((invalid.parameters.subject as Record<string, unknown>).active, "false");
});

test("three item batch continues after failure, shortcut never sends drafts, unknown retries keep ID", async (t) => {
  const h = await setup(t);
  const batch = h.bar.create(h.endpoint());
  const rev = revision(h.discovery, "echo");
  const first = h.bar.add(
    batch,
    { type: "echo", timeoutMs: 5000, text: "one", durationMs: 300 },
    rev,
  );
  const rejected = h.bar.add(batch, { type: "echo", timeoutMs: 5000, text: 42 }, rev);
  const third = h.bar.add(batch, { type: "echo", timeoutMs: 5000, text: "three" }, rev);
  await h.submit("shortcut");
  assert.deepEqual(
    batch.entries.map((entry) => entry.state),
    ["draft", "draft", "draft"],
  );
  h.bar.move(batch, 2, -1);
  h.bar.move(batch, 1, 1);
  await h.bar.sendBatch(batch);
  assert.deepEqual(
    batch.entries.map((entry) => entry.state),
    ["accepted", "failed", "accepted"],
  );
  assert.ok(first.snapshot && third.snapshot);
  assert.equal(rejected.id, batch.entries[1]!.id);
  const before = (await h.request<TaskPage>("/tasks?limit=2")).observedAt;
  await h.bar.sendBatch(batch);
  const all = await h.request<TaskPage>("/tasks?limit=2");
  assert.ok(all.observedAt >= before);
  let lost = true;
  const uncertain = new SubmissionBar(async (entry) => {
    const result = await h.send(entry);
    if (lost) {
      lost = false;
      throw new Error("response lost after acceptance");
    }
    return result;
  });
  const entry = await uncertain.quick(
    h.endpoint(),
    { type: "echo", timeoutMs: 5000, text: "lost" },
    rev,
  );
  assert.equal(entry.state, "unknown");
  const id = entry.id;
  await uncertain.retry(entry);
  assert.equal(entry.state, "accepted");
  assert.equal(entry.id, id);
  assert.equal((await h.request<Record<string, unknown>>(`/requests/${id}`)).requestId, id);
  const again = await uncertain.quick(h.endpoint(), entry.parameters, rev);
  assert.notEqual(again.id, id);
});

test("directory permissions and scopes are independent; frozen paging, raw-request redo and no summary version", async (t) => {
  const h = await setup(t);
  const first = await h.submit("from UI");
  const externalId = newIdentity();
  const raw = {
    type: "echo",
    timeoutMs: 5000,
    text: "external",
    metadata: { url: "https://example.invalid/floating", digest: "user-lock" },
  };
  const external = await fetch(`${h.backend.url}/tasks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${h.token}`,
      "content-type": "application/json",
      "Idempotency-Key": externalId,
    },
    body: JSON.stringify(raw),
  });
  assert.equal(external.status, 202);
  await h.submit("third");
  await assert.rejects(
    () => h.request("/task-types", { id: "list" }),
    (error: unknown) => error instanceof ApiError && error.status === 403,
  );
  const page = await h.request<TaskPage>("/tasks?limit=1&sort=created-desc", { id: "list" });
  assert.ok(page.next);
  assert.equal("input" in page.tasks[0]!, false);
  assert.equal("result" in page.tasks[0]!, false);
  await assert.rejects(() => h.request(`/tasks/${first.snapshot!.taskId}`, { id: "list" }), /403/);
  await assert.rejects(() => h.request(`/requests/${first.id}`, { id: "list" }), /403/);
  assert.deepEqual((await h.request<TaskPage>("/tasks", { id: "other" })).tasks, []);
  await assert.rejects(() => h.request(`/tasks/${first.snapshot!.taskId}`, { id: "other" }), /403/);
  const late = await h.submit("not in snapshot");
  const next = await h.request<TaskPage>(
    `/tasks?limit=1&sort=created-desc&cursor=${encodeURIComponent(page.next!)}`,
    { id: "list" },
  );
  assert.equal(next.observedAt, page.observedAt);
  assert.equal(next.expiresAt, page.expiresAt);
  assert.notEqual(next.tasks[0]!.taskId, late.snapshot!.taskId);
  const original = originalParameters(await h.request(`/requests/${externalId}`));
  assert.deepEqual(original, raw);
  assert.equal("version" in original, false);
  const recreated = await h.bar.quick(h.endpoint(), original, revision(h.discovery, "echo"));
  assert.equal(recreated.state, "accepted");
  assert.notEqual(recreated.id, externalId);
  const lower = new URLSearchParams({ createdFrom: first.snapshot!.receivedAt });
  assert.ok((await h.request<TaskPage>(`/tasks?${lower}`)).tasks.length > 0);
  const upper = new URLSearchParams({ createdBefore: first.snapshot!.receivedAt });
  assert.deepEqual((await h.request<TaskPage>(`/tasks?${upper}`)).tasks, []);
  await assert.rejects(() => h.request("/tasks?createdFrom=no-timezone"), /400/);
});

test("directory expiration preserves stale view and requires an explicit new query", async (t) => {
  const h = await setup(t, 80);
  await h.submit("one");
  await h.submit("two");
  const directory = new Directory();
  const fetchPage = (query: string) => h.request<TaskPage>(`/tasks?${query}`);
  await directory.load(fetchPage, "type=echo&sort=created-desc&limit=1");
  const old = directory.page;
  await new Promise((resolve) => setTimeout(resolve, 100));
  await assert.rejects(() => directory.load(fetchPage, "type=survey", true), /query_expired/);
  assert.equal(directory.expired, true);
  assert.equal(directory.page, old);
  await assert.rejects(() => directory.load(fetchPage, "", true), /重新查询/);
  await directory.load(fetchPage, "type=survey&sort=created-desc&limit=1");
  assert.deepEqual(directory.page!.tasks, []);
  assert.equal(directory.expired, false);
});

test("shared Execution, queued Task, cancellation, timeout, history/SSE and disconnect independence", async (t) => {
  const h = await setup(t);
  const eligibleAt = new Date(Date.now() + 200).toISOString();
  const a = await h.submit("shared", { eligibleAt, durationMs: 600 });
  const b = await h.submit("shared", { eligibleAt, durationMs: 600 });
  const waiting = await h.submit("waiting", { eligibleAt, durationMs: 80 });
  const snapshot = (entry: Entry) => h.request<TaskSnapshot>(`/tasks/${entry.snapshot!.taskId}`);
  const runningA = await until(
    () => snapshot(a),
    (value) => value.stage === "running",
  );
  const runningB = await until(
    () => snapshot(b),
    (value) => value.stage === "running",
  );
  assert.equal(runningA.execution!.executionId, runningB.execution!.executionId);
  assert.equal((await snapshot(waiting)).stage, "queued");
  const canceled = await h.request<TaskSnapshot>(`/tasks/${a.snapshot!.taskId}/cancel`, {
    method: "POST",
  });
  assert.ok(canceled.canceledAt);
  assert.equal((await snapshot(b)).canceledAt, undefined);
  const eventWindow = new EventWindow();
  let query = `/event-history?executionId=${runningA.execution!.executionId}&limit=2`;
  do {
    const page = await h.request<HistoryPage>(query);
    eventWindow.history(page);
    if (!eventWindow.streamCursor) eventWindow.streamCursor = page.cursor;
    query = page.next
      ? `/event-history?executionId=${runningA.execution!.executionId}&cursor=${encodeURIComponent(page.next)}&limit=2`
      : "";
  } while (query);
  assert.ok(eventWindow.events.some((event) => event.type === "execution.started"));
  assert.equal(
    eventWindow.events.some((event) => event.type === "execution.reclaimed"),
    false,
  );
  const abort = new AbortController();
  const response = await fetch(`${h.url}/api/endpoints/full/events?taskId=${b.snapshot!.taskId}`, {
    headers: { "X-UI-Token": h.csrf, "X-Endpoint-Binding": h.endpoint().binding },
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  let observations = 0;
  let resume = "";
  await consumeSse(response, (observation: Observation) => {
    observations++;
    resume = observation.cursor;
    assert.ok(observation.snapshots.some((task) => task.taskId === b.snapshot!.taskId));
    abort.abort();
  }).catch((error: unknown) => {
    assert.ok(error instanceof Error && error.name === "AbortError");
  });
  assert.ok(observations > 0);
  assert.equal((await snapshot(b)).canceledAt, undefined);
  const reconnect = new AbortController();
  const resumed = await fetch(`${h.url}/api/endpoints/full/events?taskId=${b.snapshot!.taskId}`, {
    headers: {
      "X-UI-Token": h.csrf,
      "X-Endpoint-Binding": h.endpoint().binding,
      "Last-Event-ID": resume,
    },
    signal: reconnect.signal,
  });
  assert.equal(resumed.status, 200);
  await consumeSse(resumed, (observation) => {
    assert.ok(observation.cursor);
    reconnect.abort();
  }).catch((error: unknown) => {
    assert.ok(error instanceof Error && error.name === "AbortError");
  });
  const completed = await until(
    () => snapshot(b),
    (value) => value.stage === "completed",
  );
  assert.equal((completed.result as { ok: boolean }).ok, false);
  assert.equal(completed.error, undefined);
  await until(
    () => snapshot(waiting),
    (value) => value.stage === "completed",
  );
  const timed = await h.submit("late", { timeoutMs: 30, durationMs: 200 });
  const timeout = await until(
    () => snapshot(timed),
    (value) => isTimedOut(value),
  );
  assert.equal(timeout.canceledAt, undefined);
  assert.equal(timeout.stage, "running");
  await h.closeUi();
  const backendSnapshot = await until(
    async () => {
      const result = await fetch(`${h.backend.url}/tasks/${timed.snapshot!.taskId}`, {
        headers: { authorization: `Bearer ${h.token}` },
      });
      return result.json() as Promise<TaskSnapshot>;
    },
    (value) => value.stage === "completed",
  );
  assert.equal(backendSnapshot.canceledAt, undefined);
  // Restart only our UI before teardown; no backend lifecycle operation occurred.
  await h.restart();
});

test("favorites persist across UI restart, keep original parameters, and block rebinding", async (t) => {
  const h = await setup(t);
  const parameters = {
    type: "echo",
    timeoutMs: 5000,
    text: "saved",
    metadata: { url: "https://example.invalid/latest", digest: "locked", nested: [null, false, 1] },
  };
  const response = await h.local("/api/favorites", "POST", {
    name: "完整配方",
    endpoint: h.endpoint(),
    parameters,
  });
  assert.equal(response.status, 201);
  const saved = (await response.json()) as Favorite;
  const disk = await readFile(resolve(h.root, "favorites.json"), "utf8");
  assert.equal(disk.includes(h.token), false);
  assert.equal(disk.includes("bearerEnv"), false);
  await h.restart();
  const favorites = (await (await h.local("/api/favorites")).json()) as Favorite[];
  assert.deepEqual(favorites[0]!.parameters, parameters);
  assert.equal(favorites[0]!.endpoint.binding, h.endpoint().binding);
  const redo = await h.bar.quick(
    h.endpoint(),
    originalParameters({ ...parameters, requestId: newIdentity() }),
    revision(h.discovery, "echo"),
  );
  assert.equal(redo.state, "accepted");
  assert.deepEqual(
    ((await (await h.local("/api/favorites")).json()) as Favorite[])[0]!.parameters,
    parameters,
  );
  await h.restart(true);
  assert.notEqual(saved.endpoint.binding, h.endpoint().binding);
  assert.equal(
    (
      await h.local("/api/favorites", "POST", {
        name: "不能改投",
        endpoint: saved.endpoint,
        parameters,
      })
    ).status,
    409,
  );
});
test("expired public event cursors fail explicitly and cleaned requests cannot be redone", async (t) => {
  const h = await setup(t, 60000, 100);
  const entry = await h.submit("expiring", { durationMs: 30 });
  await until(
    () => h.request<TaskSnapshot>(`/tasks/${entry.snapshot!.taskId}`),
    (snapshot) => snapshot.stage === "completed",
  );
  const page = await h.request<HistoryPage>(
    `/event-history?taskId=${entry.snapshot!.taskId}&limit=1`,
  );
  assert.ok(page.next);
  await new Promise((resolve) => setTimeout(resolve, 150));
  h.backend.engine.collect();
  await assert.rejects(
    () =>
      h.request(
        `/event-history?taskId=${entry.snapshot!.taskId}&cursor=${encodeURIComponent(page.next!)}`,
      ),
    (error: unknown) => error instanceof ApiError && error.status === 410,
  );
  const expired = await h.local(
    `/api/endpoints/full/events?taskId=${entry.snapshot!.taskId}`,
    "GET",
    undefined,
    {
      "X-Endpoint-Binding": h.endpoint().binding,
      "Last-Event-ID": page.cursor,
    },
  );
  assert.equal(expired.status, 410);
  await assert.rejects(() => h.request(`/requests/${entry.id}`), /404/);
});

test("stream admission is bounded and disconnect returns only UI-owned stream capacity", async (t) => {
  const h = await setup(t);
  const entry = await h.submit("stream-budget", { durationMs: 2000 });
  const path = `/api/endpoints/full/events?taskId=${entry.snapshot!.taskId}`;
  const headers = { "X-Endpoint-Binding": h.endpoint().binding };
  const streams: Response[] = [];
  try {
    for (let index = 0; index < 8; index++) {
      const response = await h.local(path, "GET", undefined, headers);
      assert.equal(response.status, 200);
      streams.push(response);
    }
    const over = await h.local(path, "GET", undefined, headers);
    assert.equal(over.status, 429);
    await over.body?.cancel();
    await streams.shift()!.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const reopened = await h.local(path, "GET", undefined, headers);
    streams.push(reopened);
    assert.equal(reopened.status, 200);
    assert.equal(
      (await h.request<TaskSnapshot>(`/tasks/${entry.snapshot!.taskId}`)).canceledAt,
      undefined,
    );
  } finally {
    await Promise.all(streams.map((response) => response.body?.cancel()));
  }
});

test("loopback, host/origin/CSRF, restricted proxy, headers, body limits and redirects", async (t) => {
  const h = await setup(t);
  await assert.rejects(() => startUiServer({ ...h.config, host: "0.0.0.0" }), /loopback/);
  const html = await fetch(h.url);
  assert.match(html.headers.get("content-security-policy")!, /script-src 'self'/);
  assert.equal((await html.text()).includes(h.token), false);
  const wrongHost = await new Promise<number | undefined>((accept, reject) => {
    const request = httpRequest(
      `${h.url}/api/bootstrap`,
      { headers: { Host: "attacker.invalid" } },
      (response) => {
        response.resume();
        accept(response.statusCode);
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal(
    (await fetch(`${h.url}/api/bootstrap`, { headers: { Origin: "https://attacker.invalid" } }))
      .status,
    403,
  );
  assert.equal(
    (await fetch(`${h.url}/api/bootstrap`, { headers: { "Sec-Fetch-Site": "cross-site" } })).status,
    403,
  );
  assert.equal((await fetch(`${h.url}/api/favorites`)).status, 403);
  assert.equal(
    (
      await h.local("/api/endpoints/full/http://attacker.invalid", "GET", undefined, {
        "X-Endpoint-Binding": h.endpoint().binding,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.local("/api/endpoints/full/tasks?scope=two", "GET", undefined, {
        "X-Endpoint-Binding": h.endpoint().binding,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.local("/api/endpoints/full/tasks", "DELETE", undefined, {
        "X-Endpoint-Binding": h.endpoint().binding,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.local(
        "/api/endpoints/full/tasks",
        "POST",
        { type: "echo", text: "x".repeat(70000) },
        {
          "X-Endpoint-Binding": h.endpoint().binding,
          "Idempotency-Key": newIdentity(),
          "If-Match": `"${revision(h.discovery, "echo")}"`,
        },
      )
    ).status,
    413,
  );
  const maliciousHeaders = await h.local("/api/endpoints/full/tasks", "GET", undefined, {
    "X-Endpoint-Binding": h.endpoint().binding,
    authorization: "Bearer not-the-configured-token",
  });
  assert.equal(maliciousHeaders.status, 200);
  const redirect = createServer((_req, res) => {
    res.writeHead(302, { Location: "https://example.invalid/" });
    res.end();
  });
  await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
  const address = redirect.address();
  assert.ok(address && typeof address !== "string");
  const otherUi = await startUiServer({
    port: 0,
    favoritesFile: resolve(h.root, "redirect.json"),
    endpoints: [
      { id: "redirect", label: "redirect", binding: "1", url: `http://127.0.0.1:${address.port}` },
    ],
  });
  try {
    const bootstrap = await fetch(`${otherUi.url}/api/bootstrap`).then((response) =>
      response.json(),
    );
    const response = await fetch(`${otherUi.url}/api/endpoints/redirect/task-types`, {
      headers: {
        "X-UI-Token": bootstrap.csrf,
        "X-Endpoint-Binding": bootstrap.endpoints[0].binding,
      },
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "redirect_denied");
  } finally {
    await otherUi.close();
    redirect.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      redirect.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
