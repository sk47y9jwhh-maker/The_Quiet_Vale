#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

if command -v node >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
elif [ -x "$BUNDLED_NODE" ]; then
  NODE_BIN="$BUNDLED_NODE"
else
  echo "Node.js was not found."
  echo "Install Node.js, or open this project in Codex once so the bundled runtime is available."
  exit 1
fi

cd "$ROOT_DIR"
PORT="${PORT:-5214}" exec "$NODE_BIN" server.mjs
