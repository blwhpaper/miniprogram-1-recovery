#!/bin/bash
set -euo pipefail

TASK_ID="${1:-}"
shift || true
TASK_NAME="$*"

if [ -z "$TASK_ID" ] || [ -z "$TASK_NAME" ]; then
  echo '用法: 收工 TASK-xxxx 中文任务名'
  exit 1
fi

echo "👉 正在执行收工: $TASK_ID $TASK_NAME"

# 1. 复制 Obsidian 笔记
bash .agents/skills/wechat-task-closeout/scripts/closeout_copy_note.sh

# 2. 写入 Obsidian
/Users/johntsin/bin/obs-wechat-task "$TASK_ID" "$TASK_NAME"

# 3. 复制下一个任务启动包
bash .agents/skills/wechat-task-closeout/scripts/closeout_copy_next_task.sh

echo "✅ 收工完成"
