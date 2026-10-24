# Setup Marker Objective

`@potential-guide/objective-setup-marker` contains the standalone `marker` check.
Build before explicitly preparing a `dist/package` directory or release tarball.
It verifies exactly the supplied marker bytes, never installs dependencies, and
does not grant file-write authority. Setup's bounded Agent exercise prepares and
pins this separate Objective instead of embedding a second definition.
