---
name: wechat-task-closeout
description: "Use this skill only when the user explicitly says '收工' or clearly asks to close out the current task. This skill prepares structured closeout materials for the WeChat mini-program project: git commands, an Obsidian task note draft, and the next task starter pack. It also writes the note and next-task pack to local output files so they can be copied or processed by local scripts."
---

# wechat-task-closeout

This skill is for closing out a completed task in the WeChat mini-program project.

## Goal

When the user explicitly says “收工”, output the three required closeout materials in the user's preferred format:

1. Git 代码
2. Obsidian 笔记
3. 下一个任务启动包

Additionally:
- write the Obsidian note to `.agents/skills/wechat-task-closeout/output/current_note.md`
- write the next task starter pack to `.agents/skills/wechat-task-closeout/output/next_task.md`

## When to use

Use this skill only when:
- the user explicitly says “收工”
- or clearly requests closeout materials for the current accepted task

Do not use this skill when:
- the task is still being implemented
- the user is reporting bugs or asking for more fixes
- the user is asking for a new Codex execution prompt for another repair round
- the current task has not yet been accepted by the user

## Required workflow

Before generating closeout output:

1. Review the actual files changed for the current task
2. Summarize only the changes that belong to the current accepted task
3. Exclude unrelated workspace noise from the summary whenever possible
4. Keep the result tightly scoped to the current task only
5. If verification is incomplete, state that clearly and do not overclaim

## Output format

Always output the following three sections in order.

---

## 1. Git 代码

Provide executable git commands only.

Rules:
- Prefer `git add <specific files>` over `git add .`
- Only include files that belong to the current task when reasonably clear
- Use a concise commit message in this style:

`task-任务编号 concise-summary`

If the task id already includes `TASK-`, normalize the commit message to lowercase `task-xxxx ...` format.

Do not include explanation paragraphs in this section.

---

## 2. Obsidian 笔记

Use this exact structure:

# TASK-任务编号 任务名称

## 1. 本任务完成摘要
## 2. 修改文件
## 3. 关键改动
## 4. 验收结果
## 5. 当前边界
## 6. 后续建议

Writing rules:
- Write in concise project-note style
- Be concrete
- Mention actual files when known
- Mention actual behavior changes
- Distinguish clearly between completed code changes and incomplete verification
- Do not duplicate `TASK-` in the title

After generating this note:
- write the full note content to `.agents/skills/wechat-task-closeout/output/current_note.md`

---

## 3. 下一个任务启动包

Use this exact structure:

- 任务名：
- 任务目标：
- 本轮边界：
- 预期结果：

Rules:
- Keep it concise
- Make it directly usable as the next task starter pack
- Base it on the most natural next step from the current task
- Do not expand into a long proposal
- Do not introduce unrelated future work

After generating this starter pack:
- write the full content to `.agents/skills/wechat-task-closeout/output/next_task.md`

## Local helper scripts

Helpful local scripts exist at:

- `.agents/skills/wechat-task-closeout/scripts/closeout_copy_note.sh`
- `.agents/skills/wechat-task-closeout/scripts/closeout_save_next_task.sh`

These scripts are for the user to run locally after output is generated.

## Constraints

- Do not invent files or changes that did not happen
- Do not include unrelated modified files unless clearly part of the task
- Do not expand scope beyond the current task
- Do not claim verification that did not occur
- Do not auto-commit unless the user explicitly asks for execution
- Do not output extra meta commentary before or after the three required sections
