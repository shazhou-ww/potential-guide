# @potential-guide/cli-core

Shared configuration, command protocol, atomic persistence, and ACP client used
by the `pguide` command packages. This package is an implementation component;
most users should install `pguide` and the desired command packages instead.
Agent profiles inherit credentials only by environment-variable name; common
secret-bearing transport arguments are rejected before profiles can be shown
or persisted. Guide revisions cover the complete local Guide and prerequisite
content tree rather than only the manifest.
