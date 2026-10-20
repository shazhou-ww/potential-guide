#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "$(id -u)" == 0 || "${XDG_RUNTIME_DIR:-}" != /work/runtime ||
      "${DBUS_SESSION_BUS_ADDRESS:-}" != unix:path=/work/runtime/bus ]]; then
  echo "Keychain requires the non-root container's private runtime directory." >&2
  exit 1
fi
mkdir -p "$XDG_RUNTIME_DIR/keyring"
chmod 700 "$XDG_RUNTIME_DIR" "$XDG_RUNTIME_DIR/keyring"
if dbus-send --session --print-reply --reply-timeout=1000 \
    --dest=org.freedesktop.DBus /org/freedesktop/DBus \
    org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
  echo "A session bus is already running; refusing a second keychain supervisor." >&2
  exit 1
fi
if [[ -S "$XDG_RUNTIME_DIR/bus" ]]; then
  rm -- "$XDG_RUNTIME_DIR/bus"
fi

bus_pid=
command_pid=
cleanup() {
  trap - EXIT
  for pid in "$command_pid" "$bus_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  wait || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
dbus-daemon --session --nofork --nopidfile --address="$DBUS_SESSION_BUS_ADDRESS" &
bus_pid=$!
bus_ready=false
for _ in {1..50}; do
  if dbus-send --session --print-reply --reply-timeout=1000 \
      --dest=org.freedesktop.DBus /org/freedesktop/DBus \
      org.freedesktop.DBus.ListNames >/dev/null 2>&1; then
    bus_ready=true
    break
  fi
  kill -0 "$bus_pid"
  sleep 0.1
done
if [[ "$bus_ready" != true ]]; then
  echo "Private session bus did not become ready." >&2
  exit 1
fi

"$@" &
command_pid=$!
exited_pid=
set +e
wait -n -p exited_pid "$bus_pid" "$command_pid"
status=$?
set -e
if [[ "$exited_pid" != "$command_pid" ]]; then
  echo "The private session bus exited; stopping the container command." >&2
  exit 1
fi
exit "$status"
