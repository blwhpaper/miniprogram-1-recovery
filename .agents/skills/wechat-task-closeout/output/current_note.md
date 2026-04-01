# TASK-032 下课后课次失效与新二维码仍命中旧课次问题排查

## 1. 本任务完成摘要
- 完成下课、当前课解析、二维码生成、学生扫码绑定 lessonId 四条链路排查。
- 确认“老师下课后学生端仍停留旧课并可继续互动”的根因是学生侧对 ended lesson 仍放行，不是老师端未写下课状态。
- 确认“新二维码仍命中旧课次”在现有代码里不是 createLesson/createSignCode 绑错 lessonId，而是学生侧旧 lessonId 持续复用导致的表象。

## 2. 修改文件
- .agents/skills/wechat-task-closeout/output/current_note.md

## 3. 关键改动
- 本轮未改业务代码，仅完成代码排查与根因收口。
- lessons 真源确认：老师端下课会把 lessons.status 写为 ended，并补 endTime。
- 当前课解析确认：教师侧 current lesson 只认 status=active；学生侧 resolveStudentLessonEntry 在显式传入旧 lessonId 时会直接读取该课，并对已签到学生继续返回 canEnterCurrentLesson=true。
- 互动门禁确认：studentHome、studentSign、studentQuestion 当前主要按 hasSigned / attendance 放行，未把 lesson.status=ended 收进互动禁用判断。
- 二维码链路确认：二维码 scene 直接等于 lessonId，代码中未发现 signCodes 集合绑定旧 lessonId 的实现。

## 4. 验收结果
- 已完成代码级事实排查与证据链收口。
- 未直接实施修复。
- 未做真机回归与云端数据验证。

## 5. 当前边界
- 本轮仅做排查，不做重构，不扩大到无关页面。
- 未修改前端业务页、云函数、数据库字段定义。
- 当前结论基于仓库现有代码，未宣称线上已修复或已生效。

## 6. 后续建议
- 先最小修改 cloudfunctions/resolveStudentLessonEntry/index.js，收紧 ended lesson 的当前课放行逻辑。
- 再在 miniprogram/pages/studentHome/studentHome.js 与 miniprogram/pages/studentQuestion/studentQuestion.js 补 lesson.status 门禁，结束课次后关闭继续进入与主动提问。
- 若要进一步消除老师侧观察误差，可把 classHome 下课动作收口为云函数执行并补云端状态回读。
