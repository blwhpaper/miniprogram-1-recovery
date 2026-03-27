#!/usr/bin/env bash
set -euo pipefail

NEXT_FILE="${1:-.agents/skills/wechat-task-closeout/output/next_task.md}"

if [[ ! -f "$NEXT_FILE" ]]; then
  echo "Next task file not found: $NEXT_FILE" >&2
  exit 1
fi

pbcopy < "$NEXT_FILE"
echo "Next task starter pack copied to clipboard from: $NEXT_FILE"
