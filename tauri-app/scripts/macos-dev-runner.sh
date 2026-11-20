#!/bin/sh
# Cargo supplies: executable [application arguments...].
# exec preserves Cargo/Tauri's process lifecycle and Rust hot-reload termination.
set -eu
if [ "$#" -lt 1 ]; then
  echo 'Signed dev runner requires an executable' >&2
  exit 64
fi
: "${BOXPLAYER_DEV_NODE:?Missing signed dev Node runtime}"
: "${BOXPLAYER_DEV_SIGNER:?Missing signed dev signer}"
"$BOXPLAYER_DEV_NODE" "$BOXPLAYER_DEV_SIGNER" "$1"
exec "$@"
