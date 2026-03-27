#!/usr/bin/env bash
set -euo pipefail

TARGET_FILE="${1:-.agents/skills/wechat-task-closeout/output/next_task.md}"

mkdir -p "$(dirname "$TARGET_FILE")"

cat > "$TARGET_FILE"

echo "Next task starter pack saved to: $TARGET_FILE"
