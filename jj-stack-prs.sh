#!/usr/bin/env bash
# Lightweight wrapper for jj-stack-prs that uses installed Deno

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec deno run --allow-run --allow-read --allow-write --allow-env "$SCRIPT_DIR/src/main.ts" "$@"