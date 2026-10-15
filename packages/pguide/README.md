# pguide

The extensible Potential Guide command line.

```sh
npx pguide --help
pguide probe --guide ./objective-guide.yaml --subject-file ./subject.json
pguide regulate --guide ./objective-guide.yaml --subject-file ./subject.json --target terminal
```

The package is the CLI composition root. It provides the `pguide` executable
used by `npx`, plus the official `probe`, `regulate`, `continue`, `supervise`,
`scaffold`, and `validate` command adapters as independent `pguide-<command>`
executables. The optional `@potential-guide/config` extension provides
`pguide-config`; `diagnose` and `complete` are built in.

Objective Guide, Regulator, and Portfolio Supervisor packages contain domain
logic only and never depend on CLI Core. Extension package names are independent
of the command names advertised by their executable metadata.

External executables and Windows command shims are invoked without shell mode,
so argument boundaries and metacharacters are preserved.
