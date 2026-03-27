#!/usr/bin/env bash
set -euo pipefail

NOTE_FILE="${1:-.agents/skills/wechat-task-closeout/output/current_note.md}"

if [[ ! -f "$NOTE_FILE" ]]; then
  echo "Note file not found: $NOTE_FILE" >&2
  exit 1
fi

pbcopy < "$NOTE_FILE"
echo "Obsidian note copied to clipboard from: $NOTE_FILE"
