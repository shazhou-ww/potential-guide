# Task Engine Web UI

Private Chinese debugging workbench, served by an independently started,
loopback-only Node HTTP process. The production UI uses only public Task Server
HTTP; the explicitly started `fixture/` composition is for isolated verification.

See [运行、边界及浏览器验证](../../docs/task-engine-web-ui.md).

```powershell
pnpm exec turbo run build --filter=@potential-guide/task-engine-web-ui...
pnpm --filter @potential-guide/task-engine-web-ui start D:\Private\task-ui\ui-config.json
```

No npm release, remote-user access control, asset management or backend
lifecycle ownership is provided.

Task and Run directories use TanStack Table with the existing React/shadcn styling.
Single-line column headers contain sorting controls and filter icons. Native
popovers contain all filters, including favorites, name/ID, status and Bundle/time
query inputs, without changing header height. The table footer contains loaded-record pagination and the
separate server cursor continuation; partial directories are explicitly labeled.
Snapshot information and query errors also stay in the footer, so live status
changes do not move the headers.

The workbench has Task and Run pages only. IPFS content is managed by the independent
node; Engine's internal memory reuse is not exposed as a cache page or public API.
See [content storage and reuse](../../docs/task-bundle-cache.md).
Run detail includes an independent Logs interface with follow/pause, sequence
resume, history paging, explicit missing/expired/unsupported states, and a
300-entry / 1-MiB browser window. See
[Run Logs and standalone UI verification](../../docs/task-run-logs.md).
