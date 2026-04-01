# TASK-031 主动提问链路 UI 落地

## 1. 本任务完成摘要
- 完成 studentQuestion 与 classInteraction 两页的主动提问链路 UI 落地。
- 学生端收口为单按钮提问请求页，教师端收口为提问请求管理页。
- 补齐学生端在“非 approved -> approved”切换时的单次震动提示。

## 2. 修改文件
- miniprogram/pages/studentQuestion/studentQuestion.js
- miniprogram/pages/studentQuestion/studentQuestion.wxml
- miniprogram/pages/studentQuestion/studentQuestion.wxss
- miniprogram/pages/classInteraction/classInteraction.js
- miniprogram/pages/classInteraction/classInteraction.wxml
- miniprogram/pages/classInteraction/classInteraction.wxss

## 3. 关键改动
- studentQuestion：重做页面承载，改为学院蓝主视觉 + 神灯提示 + 单一“发起提问”按钮。
- studentQuestion：基于现有 question_request / question_approved / question_score 状态收口未发起、等待中、已允许三段展示。
- studentQuestion：修复老师允许后震动提示，只在非 approved 首次切到 approved 时触发一次。
- classInteraction：重做为提问请求管理页，顶部展示当前请求人数，下方以请求列表承载学生申请。
- classInteraction：保留现有允许与评分逻辑，不改接口、不改轮询主链路。

## 4. 验收结果
- 已完成代码落地。
- 已做 studentQuestion.js 语法检查。
- 未做真机全链路验收，未补充截图回归记录。

## 5. 当前边界
- 本轮仅覆盖 miniprogram/pages/studentQuestion/* 与 miniprogram/pages/classInteraction/*。
- 未扩展到 randomRollcall、studentHome、classHome 等其他页面。
- 未新增云函数、接口、数据库字段、全局状态管理。

## 6. 后续建议
- 真机回归学生发起 -> 教师允许 -> 学生端震动提示完整链路。
- 回归教师端“已有进行中提问时不可连续允许下一位”的边界。
- 回归历史课次切换，确认请求列表与处理记录展示正常。
