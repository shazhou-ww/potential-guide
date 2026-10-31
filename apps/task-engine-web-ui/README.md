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
