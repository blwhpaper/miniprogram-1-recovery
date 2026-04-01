# TASK-036 教师端随机点名入口恢复与链路校正

## 1. 本任务完成摘要
- 恢复教师端进入随机点名页的可见入口。
- 校正教师侧到 `randomRollcall` 的实际可点击链路，教师现在可从课堂互动页进入随机点名页。

## 2. 修改文件
- `miniprogram/pages/classInteraction/classInteraction.wxml`

## 3. 关键改动
- 在 `classInteraction` 页概览区域补回“随机点名”按钮。
- 按钮复用已有 `goToRandomRollcall` 事件，不新造跳转逻辑。
- 按 `selectedLessonId` 控制入口显示，避免无课次时出现无效入口。

## 4. 验收结果
- 代码检查确认 `randomRollcall` 页面已在 `miniprogram/app.json` 注册。
- 代码检查确认 `classInteraction.js` 中已有正确跳转函数与页面路径。
- 本轮已补回 WXML 入口节点。
- 尚未在微信开发者工具内实际手点验证，当前结论为本地代码已修复。

## 5. 当前边界
- 仅修复教师端随机点名入口缺失问题。
- 未改 `randomRollcall` 页面内部 UI、动画、样式和业务逻辑。
- 未调整其他教师端入口、文案或页面布局。

## 6. 后续建议
- 在微信开发者工具中按教师链路手测：`teacherHome -> classManager -> classHome -> classInteraction -> randomRollcall`。
- 重点确认有课次时入口可见、无课次时入口不显示、点击后可携带正确 `classId` 和 `lessonId` 跳转。
