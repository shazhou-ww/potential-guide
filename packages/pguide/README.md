# pguide

The extensible Potential Guide command line.

```sh
npx pguide --help
pguide probe --guide ./objective-guide.yaml --subject-file ./subject.json
pguide regulate --guide ./objective-guide.yaml --subject-file ./subject.json --target terminal
```

Commands are independent `pguide-<command>` executables. The official command
packages provide `probe`, `regulate`, `continue`, `supervise`, `scaffold`,
`validate`, and optional `config`; `diagnose` and `complete` are built in.
External executables and Windows command shims are invoked without shell mode,
so argument boundaries and metacharacters are preserved.
