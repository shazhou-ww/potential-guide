#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ ! -t 0 || ! -t 1 ]]; then
  echo "Run this command in your own interactive terminal; do not pipe a password." >&2
  exit 1
fi
password=
confirmation=
trap 'unset password confirmation' EXIT
read -r -s -p "Container keychain password: " password
printf '\n'
if [[ -z "$password" ]]; then
  echo "An empty password is not allowed." >&2
  exit 1
fi
read -r -s -p "Confirm keychain password: " confirmation
printf '\n'
if [[ "$password" != "$confirmation" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi
printf '%s' "$password" | gnome-keyring-daemon --replace --unlock --components=secrets \
  --control-directory="$XDG_RUNTIME_DIR/keyring" >/dev/null
unset password confirmation
node /harness/keychain.mjs --require-unlocked
