# Content mismatch

The selected file is absent or does not exactly match the delivered expected text.
Inspect the `file` problem parameter and compare that file's UTF-8 bytes with the
artifact's `resources/expected.txt`, including line endings and the final newline.
Create or update only the intended target file after confirming authorization,
then execute the Check again. Do not edit the cached artifact to change its answer.
