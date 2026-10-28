# File content Check

Compares a caller-selected file with the exact UTF-8 text delivered in
`resources/expected.txt`. The subject is `{ "file": "<absolute file path>" }`.
Missing files and unequal bytes report `content-mismatch`. Other IO failures are
invocation errors, not a successful business result. The Check only reads files.

The worker bundles Ajv; consumers must not install the Check's author dependencies.
This trusted code is not sandboxed. Choose its source and target permissions deliberately.
