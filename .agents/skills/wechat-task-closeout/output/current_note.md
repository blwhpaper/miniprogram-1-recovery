# TASK-019A UI 前冻结验收与教师主链路回归基线建立

## 1. 本任务完成摘要
本轮未改业务代码，完成了教师主链路在 UI 改造前的冻结验收与基线复核。
已基于当前代码确认 teachers 正式老师真源、users.teacherApplication 申请态职责、teacherHome 状态机、adminTeacherReview 审核链路、teacherSession 门禁、index 与 studentHome 的入口分发，并整理出可复用的人工回归基线。

## 2. 修改文件
.agents/skills/wechat-task-closeout/output/current_note.md

## 3. 关键改动
通读 teacherApply、getMyUser、teacherSession、teacherHome、teacherApply、adminTeacherReview、index、classManager、studentHome、classHome、signRecord 等教师主链路相关文件，确认当前真实职责边界与状态流转。
确认正式老师唯一放行依据已稳定收口到 teachers 真源：teachers.active 且 teacherId 非空。
确认 users.teacherApplication 只承接申请态，teachers.pending 承接预建档，teachers.active 承接正式老师身份。
确认 teacherHome 当前存在未申请、待审核、已驳回、已通过可进入教师工作区、已退出教师态、已通过待同步等状态。
确认 adminTeacherReview 只负责待审核申请，安全校验依赖管理员口令或白名单，审核与 reset 后会重新刷新列表。
整理出 UI 前冻结结论、P0/P1/P2 阻塞项分类，以及后续 UI 改造必须保持不变的业务口径与最小人工回归清单。

## 4. 验收结果
本轮代码级冻结验收结论为：基本可以进入 UI 阶段，但仍有少量 P1 问题。
当前未发现必须先修、不修就不能开始 UI 的 P0 阻塞项。
当前环境 cloud1-2gth4gqe76c8a563 下 users 与 teachers 样本为空，本轮未做真机联调，只完成了代码级基线复核与入口/门禁链路检查。

## 5. 当前边界
本轮只做冻结前验收、基线建立、人工回归清单整理，不做 UI 美化，不重构老师体系，不改 teachers 真源口径，不改数据库结构，不写迁移脚本。
本轮未顺手修改学生主链路、课堂功能全链路或无关页面。
当前工作区中 adminTeacherReview.wxml 有已有本地改动，但不是本轮新增修改，本轮只按现状读取并纳入基线判断。

## 6. 后续建议
进入 UI 阶段前，先保留本轮基线结论与回归清单，后续所有 UI 任务都应以不改变 teachers 真源、users.teacherApplication 职责、teacherSession 门禁逻辑为前提。
进入 UI 阶段后优先关注两类 P1：管理员审核入口偏弱，以及教师申请页“待同步”状态的按钮文案与真实状态不完全一致。
如后续需要补真机对照物，建议先用一组真实申请/审核样本补一轮截图或录屏基线，再开始页面改版。
