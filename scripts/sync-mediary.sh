#!/usr/bin/env bash
# Pull upstream mediary-scout packages/workflow into vendor/mediary-workflow.
#
#   scripts/sync-mediary.sh <path-to-mediary-scout-checkout> [branch]
#
# The checkout is updated to <branch> (default main), its packages/workflow is split into a
# local branch, and that branch is subtree-pulled. Our patches (see electron/main/mediary/README.md)
# stay as commits on top; resolve conflicts in vendor/mediary-workflow if upstream touched them.
set -euo pipefail

upstream="${1:?usage: scripts/sync-mediary.sh <path-to-mediary-scout-checkout> [branch]}"
branch="${2:-main}"
root="$(git rev-parse --show-toplevel)"

if [ -n "$(git -C "$root" status --porcelain)" ]; then
  echo "Working tree has changes; commit or set them aside before syncing." >&2
  exit 1
fi

git -C "$upstream" fetch origin "$branch"
git -C "$upstream" checkout "$branch"
git -C "$upstream" pull --ff-only origin "$branch"
git -C "$upstream" subtree split --prefix=packages/workflow -b boxplayer-workflow
version="$(git -C "$upstream" describe --tags --always)"

git -C "$root" subtree pull --prefix=vendor/mediary-workflow "$upstream" boxplayer-workflow --squash \
  -m "vendor: sync mediary-scout packages/workflow ($version)"

echo "Synced. Run: pnpm run test:mediary"
