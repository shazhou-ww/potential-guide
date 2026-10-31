import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { MemoryStore } from "@potential-guide/task-engine/testing";
import { startTaskServer } from "@potential-guide/task-engine-server";
import { TaskError, type TaskSnapshot } from "@potential-guide/task-protocol";
import { parseHTML } from "linkedom";
import { fixtureTypes } from "../fixture/types.js";
import { newIdentity } from "../src/model.js";
import { type Endpoint, type Favorite, startUiServer } from "../src/server.js";

async function until(check: () => boolean | Promise<boolean>, reason: string): Promise<void> {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(reason);
}
test("actual browser entry ignores delayed real favorites responses and paginates applied execution filters", async (t) => {
  const root = resolve(".cache", `workbench-races-${randomUUID()}`);
  await mkdir(root, { recursive: true });
  const nativeFetch = globalThis.fetch;
  const env = `UI_RACE_${randomBytes(8).toString("hex")}`,
    token = randomBytes(32).toString("hex");
  process.env[env] = token;
  process.env[`${env}_OTHER`] = `${token}-other`;
  const resources = fixtureTypes();
  const backend = await startTaskServer({
    port: 0,
    store: new MemoryStore(),
    ownStore: true,
    types: resources.types,
    currentVersions: { echo: "1", survey: "1" },
    limits: { pageSize: 10 },
    authorize: (caller, _operation, scope) => caller.scope === scope,
    resolveCaller(request) {
      if (request.headers.get("authorization") === `Bearer ${token}`)
        return { scope: "one", subject: "ui" };
      if (request.headers.get("authorization") === `Bearer ${token}-other`)
        return { scope: "other", subject: "ui" };
      throw new TaskError("unauthenticated", "Fixture authentication required.");
    },
    closeResources: resources.close,
    http: { pollMs: 20 },
  });
  const ui = await startUiServer({
    port: 0,
    favoritesFile: resolve(root, "favorites.json"),
    endpoints: [
      { id: "one", label: "原目标", binding: "one", url: backend.url, bearerEnv: env },
      {
        id: "other",
        label: "另一个目标",
        binding: "other",
        url: backend.url,
        bearerEnv: `${env}_OTHER`,
      },
    ],
  });
  for (const url of [backend.url, ui.url])
    assert.equal(
      [9223, 61123, 61144, 62952, 61109].includes(Number(new URL(url).port)),
      false,
      "never contact protected trial ports",
    );
  const { window, document } = parseHTML(
    await readFile(new URL("../src/index.html", import.meta.url), "utf8"),
  );
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    Option: globalThis.Option,
  };
  const selectValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
  const scroll = window.HTMLElement.prototype.scrollIntoView;
  Object.defineProperty(window.HTMLSelectElement.prototype, "value", {
    configurable: true,
    get(this: HTMLSelectElement) {
      return [...this.options].find((item) => item.selected)?.value ?? "";
    },
    set(this: HTMLSelectElement, value: string) {
      const options = [...this.options];
      for (const item of options) item.removeAttribute("selected");
      options.find((item) => item.value === value)?.setAttribute("selected", "");
    },
  });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const bootstrap = (await (await nativeFetch(`${ui.url}/api/bootstrap`)).json()) as {
    csrf: string;
    endpoints: Endpoint[];
  };
  const local = (path: string, method = "GET", body?: unknown) =>
    nativeFetch(`${ui.url}${path}`, {
      method,
      headers: {
        Origin: ui.url,
        "X-UI-Token": bootstrap.csrf,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const create = async (text: string): Promise<TaskSnapshot> => {
    const response = await nativeFetch(`${backend.url}/tasks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "Idempotency-Key": newIdentity(),
      },
      body: JSON.stringify({ type: "echo", timeoutMs: 5000, durationMs: 1, text }),
    });
    assert.equal(response.status, 202);
    return response.json() as Promise<TaskSnapshot>;
  };
  const held: { value: Favorite[]; release(): void }[] = [];
  let holdNext = false,
    inFlight = 0;
  let failFavorites = false;
  const browserRequests: URL[] = [];
  const transport: typeof fetch = async (input, options) => {
    const url = new URL(String(input), ui.url);
    if (url.origin !== ui.url) return nativeFetch(input, options);
    const headers = new Headers(options?.headers);
    if (options?.method && options.method !== "GET") headers.set("Origin", ui.url);
    browserRequests.push(url);
    inFlight++;
    try {
      if (failFavorites && url.pathname.startsWith("/api/favorites")) {
        const writing = options?.method === "POST" || options?.method === "DELETE";
        return new Response(
          JSON.stringify({
            error: {
              code: writing ? "write_failure" : "refresh_failure",
              message: writing ? "write unavailable" : "read unavailable",
            },
          }),
          { status: writing ? 403 : 503, headers: { "Content-Type": "application/json" } },
        );
      }
      const response = await nativeFetch(url, { ...options, headers });
      if (
        url.pathname === "/api/favorites" &&
        (!options?.method || options.method === "GET") &&
        holdNext
      ) {
        holdNext = false;
        // Consume and hold the actual HTTP body: never manufacture a favorites snapshot.
        const body = await response.text();
        return await new Promise<Response>((accept) => {
          held.push({
            value: JSON.parse(body) as Favorite[],
            release: () =>
              accept(new Response(body, { status: response.status, headers: response.headers })),
          });
        });
      }
      return response;
    } finally {
      inFlight--;
    }
  };
  Object.assign(globalThis, {
    window,
    document,
    fetch: transport,
    Option: function Option(text: string, value: string) {
      const option = document.createElement("option");
      option.textContent = text;
      option.value = value;
      return option;
    },
  });
  const element = <T extends HTMLElement = HTMLElement>(selector: string) => {
    const value = document.querySelector(selector);
    assert.ok(value, selector);
    return value as unknown as T;
  };
  const star = (id: string) => element<HTMLButtonElement>(`#directory [data-key="star:${id}"]`);
  const detailStar = () => element<HTMLButtonElement>("#task-detail .star");
  const stored = async () => (await (await local("/api/favorites")).json()) as Favorite[];
  const persisted = async (id: string) =>
    (await stored()).some((item) => item.source?.taskId === id);
  const clickNamed = (selector: string, name: string) => {
    const control = [...element(selector).querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent === name,
    );
    assert.ok(control, name);
    control.click();
  };
  try {
    const a = await create("A"),
      b = await create("B"),
      c = await create("C");
    const legacy = await local("/api/favorites", "POST", {
      name: "保留旧模板",
      endpoint: bootstrap.endpoints[0],
      parameters: { type: "echo", timeoutMs: 5000, text: "legacy original" },
    });
    assert.equal(legacy.status, 201);
    await import("../src/browser.js");
    await until(
      () => !!document.querySelector(`#directory [data-key="star:${a.taskId}"]`),
      "real Task directory should load",
    );
    element<HTMLInputElement>("#task-lookup input").value = b.taskId;
    element<HTMLButtonElement>("#task-lookup button").click();
    await until(() => !!document.querySelector("#task-detail .star"), "B detail should open");

    holdNext = true;
    star(a.taskId).click();
    await until(() => held.length === 1, "hold A's real refresh response");
    assert.equal(
      held[0]!.value.some((item) => item.source?.taskId === a.taskId),
      true,
    );
    assert.equal(
      held[0]!.value.some((item) => item.source?.taskId === b.taskId),
      false,
    );
    star(b.taskId).click();
    await until(
      () => detailStar().getAttribute("aria-pressed") === "true",
      "B's newer GET must update detail",
    );
    assert.equal(await persisted(b.taskId), true);
    held[0]!.release();
    await until(() => inFlight === 0 && !star(a.taskId).disabled, "old A callback must finish");
    assert.equal(star(b.taskId).getAttribute("aria-pressed"), "true");
    assert.equal(
      detailStar().getAttribute("aria-pressed"),
      "true",
      "old caller must not redraw B as unstarred",
    );

    holdNext = true;
    star(c.taskId).click();
    await until(() => held.length === 2, "hold a real snapshot containing B before deletion");
    assert.equal(
      held[1]!.value.some((item) => item.source?.taskId === b.taskId),
      true,
    );
    star(b.taskId).click();
    await until(
      () => detailStar().getAttribute("aria-pressed") === "false",
      "unstar must refresh detail",
    );
    assert.equal(await persisted(b.taskId), false);
    held[1]!.release();
    await until(
      () => inFlight === 0 && !star(c.taskId).disabled,
      "old snapshot callback must finish",
    );
    assert.equal(star(b.taskId).getAttribute("aria-pressed"), "false");
    assert.equal(detailStar().getAttribute("aria-pressed"), "false");

    holdNext = true;
    star(b.taskId).click();
    await until(() => held.length === 3, "hold original target's refresh");
    const select = element<HTMLSelectElement>("#endpoint");
    select.value = "other";
    select.dispatchEvent(new window.Event("change"));
    await until(
      () =>
        element("#notice").textContent!.includes("另一个目标") &&
        !document.querySelector("#directory .star"),
      "target switch should not mix Tasks",
    );
    held[2]!.release();
    await until(() => inFlight === 0, "old target refresh must settle");
    assert.equal(select.value, "other");
    assert.match(element("#notice").textContent!, /另一个目标/);
    assert.match(element("#favorites-list").textContent!, /保留旧模板/);
    assert.equal(
      (await stored()).some((item) => !item.source && item.name === "保留旧模板"),
      true,
    );
    select.value = "one";
    select.dispatchEvent(new window.Event("change"));
    await until(
      () =>
        !!document.querySelector(`#directory [data-key="star:${b.taskId}"]`) &&
        star(b.taskId).getAttribute("aria-pressed") === "true",
      "return to original target must show persisted star",
    );

    await t.test(
      "failed favorite write and failed recovery read report both causes without replacing confirmed data",
      async () => {
        element<HTMLInputElement>("#task-lookup input").value = b.taskId;
        element<HTMLButtonElement>("#task-lookup button").click();
        await until(
          () =>
            !!document.querySelector("#task-detail .star") &&
            detailStar().getAttribute("aria-pressed") === "true",
          "confirmed favorite detail should be available",
        );
        failFavorites = true;
        try {
          star(b.taskId).click();
          await until(
            () => element("#notice").textContent!.includes("修改失败且刷新失败"),
            "both failures must be visible",
          );
          const message = element("#notice").textContent!;
          assert.match(message, /当前仅为上次确认数据/);
          assert.match(message, /403 write_failure.*write unavailable/);
          assert.match(message, /503 refresh_failure.*read unavailable/);
          assert.equal(star(b.taskId).getAttribute("aria-pressed"), "true");
          assert.equal(detailStar().getAttribute("aria-pressed"), "true");
          assert.equal(await persisted(b.taskId), true);
        } finally {
          failFavorites = false;
        }
      },
    );

    for (let index = 0; index < 11; index++) await create(`execution-${index}`);
    await until(async () => {
      const page = backend.engine.listExecutions({}, {}, { scope: "one", subject: "ui" });
      return (
        !!page.next &&
        backend.engine.listExecutions({}, { cursor: page.next }, { scope: "one", subject: "ui" })
          .executions.length === 4
      );
    }, "fixture should expose 14 executions");
    const from = new Date(Date.now() - 60000).toISOString(),
      before = new Date(Date.now() + 60000).toISOString();
    element<HTMLInputElement>("#execution-type").value = "echo";
    element<HTMLInputElement>("#started-from").value = from;
    element<HTMLInputElement>("#started-before").value = before;
    element<HTMLButtonElement>("#tab-executions").click();
    await until(
      () => document.querySelectorAll("#execution-directory tbody tr").length === 10,
      "first frozen execution page has ten members",
    );
    element<HTMLInputElement>("#execution-type").value = "unapplied-type";
    element<HTMLInputElement>("#started-from").value = "not-a-date";
    element<HTMLInputElement>("#started-before").value = "also-not-a-date";
    clickNamed("#execution-directory", "执行目录下一页");
    await until(
      () => document.querySelectorAll("#execution-directory tbody tr").length === 14,
      "continuation must ignore unapplied invalid filters",
    );
    const reads = browserRequests.filter((url) => url.pathname.endsWith("/executions"));
    assert.equal(reads.length, 2);
    assert.equal(reads[1]!.searchParams.get("type"), "echo");
    assert.equal(reads[1]!.searchParams.get("startedFrom"), from);
    assert.equal(reads[1]!.searchParams.get("startedBefore"), before);
    assert.ok(reads[1]!.searchParams.get("cursor"));
    assert.equal(element<HTMLInputElement>("#started-from").value, "not-a-date");
    assert.equal(element("#execution-directory").textContent!.includes("不可用"), false);
    clickNamed("#execution-actions", "刷新执行目录");
    await until(
      () => element("#execution-directory").textContent!.includes("真实日期"),
      "new queries must still validate new filters",
    );
    assert.equal(browserRequests.filter((url) => url.pathname.endsWith("/executions")).length, 2);
    assert.equal(document.querySelectorAll("#execution-directory tbody tr").length, 14);
  } finally {
    holdNext = false;
    for (const response of held) response.release();
    await until(
      () => inFlight === 0 && !document.querySelector('[data-busy="true"]'),
      "owned browser callbacks should settle",
    ).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 30));
    window.dispatchEvent(new window.Event("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    Object.assign(globalThis, original);
    if (selectValue)
      Object.defineProperty(window.HTMLSelectElement.prototype, "value", selectValue);
    window.HTMLElement.prototype.scrollIntoView = scroll;
    await ui.close();
    await backend.close();
    delete process.env[env];
    delete process.env[`${env}_OTHER`];
    await rm(root, { recursive: true, force: true });
  }
});
