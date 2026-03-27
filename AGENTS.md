# AGENTS.md

## 收工指令规则（强制执行）

当用户输入：

收工 TASK-xxxx 中文任务名

必须执行：

1. 强制调用 wechat-task-closeout skill
2. 不允许模型自行生成收工内容（禁止模拟）
3. 输出必须来自 skill，包括：
   - Git 提交命令（基于实际改动文件）
   - Obsidian 笔记（写入 current_note.md）
   - 下一个任务启动包（写入 next_task.md）

如果 skill 执行失败：
才允许按同样结构 fallback 输出。

---

## 执行优先级

收工指令优先级高于普通对话：
- 一旦识别为“收工 TASK-xxxx ...”，必须进入 closeout 流程
- 不进行解释、闲聊或方案分析
- 直接输出结果

---

## 输出结构（严格）

必须输出三部分：

## 1. Git 代码
git add <真实修改文件>
git commit -m "task-xxxx 描述"

## 2. Obsidian 笔记
（完整笔记内容）

## 3. 下一个任务启动包
- 任务名：
- 任务目标：
- 本轮边界：
- 预期结果：

---

## 禁止行为

- 禁止输出 git status 作为收工结果
- 禁止出现“测试流程”“模拟收工”等字样
- 禁止未基于实际改动生成内容
- 禁止遗漏 output 文件写入逻辑

---

## fallback 规则（兜底）

只有在 wechat-task-closeout skill 不可用时：
才允许模型自行生成，但必须保持完全一致结构。
