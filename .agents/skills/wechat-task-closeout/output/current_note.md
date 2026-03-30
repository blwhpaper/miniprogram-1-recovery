# TASK-020A/B UI 冻结后真机回归与兼容性收口

## 1. 本任务完成摘要
- 收口首页分发页的安全区与卡片宽度，减少刘海屏和底部横条设备上的遮挡风险。
- 收口学生首页、教师首页、教师申请页的加载态/错误态承接，避免旧内容与新状态并存。
- 给公共按钮组补齐多行换行、最小高度和点击区域兜底，降低真机小屏长文案挤压与按钮不可点风险。
- 给学生首页、教师首页、教师申请页增加防旧请求回写处理，减少二次进入、前后台切换后的状态闪动和文案卡住。

## 2. 修改文件
- miniprogram/app.wxss
- miniprogram/pages/index/index.wxss
- miniprogram/pages/studentHome/studentHome.js
- miniprogram/pages/studentHome/studentHome.wxml
- miniprogram/pages/teacherHome/teacherHome.js
- miniprogram/pages/teacherHome/teacherHome.wxml
- miniprogram/pages/teacherApply/teacherApply.js
- miniprogram/pages/teacherApply/teacherApply.wxml

## 3. 关键改动
- `miniprogram/app.wxss`：统一 `ui-button-group`、`ui-record-actions`、`ui-state-actions` 下按钮的换行、最小高度、内边距和点击区域；补充横向课次列表底部留白。
- `miniprogram/pages/index/index.wxss`：补顶部/底部安全区内边距，修正分发卡片宽度计算。
- `miniprogram/pages/studentHome/studentHome.js`：新增 `pageLoading`、`pageErrorText`、`stateLoadToken` 和统一刷新入口，阻止旧请求覆盖新状态。
- `miniprogram/pages/studentHome/studentHome.wxml`：增加统一加载态/错误态，仅在状态稳定后渲染学生信息、本课汇总和快捷操作。
- `miniprogram/pages/teacherHome/teacherHome.js`、`miniprogram/pages/teacherApply/teacherApply.js`：增加请求令牌，避免 `onLoad`/`onShow` 并发导致身份态和申请态闪回。
- `miniprogram/pages/teacherHome/teacherHome.wxml`、`miniprogram/pages/teacherApply/teacherApply.wxml`：改为加载态、错误态、正常内容三段式渲染，避免加载过程中旧按钮和旧表单误显示。

## 4. 验收结果
- 已完成代码侧最小收口，改动范围聚焦安全区、状态承接、按钮布局和页面刷新稳定性。
- 已通过 `node -c` 对 `studentHome.js`、`teacherHome.js`、`teacherApply.js` 的语法检查。
- 已通过 `git diff --check`，当前提交内容无明显空白或 patch 格式问题。
- 当前未直接完成微信真机全量回归，真机兼容性仍需以目标机型手测结果为准。

## 5. 当前边界
- 本轮只处理 UI 冻结后的真机回归与兼容性收口。
- 未新增功能，未改业务口径，未改数据库结构，未改云函数。
- 未继续扩大到 `classHome`、`signRecord`、`classInteraction`、`randomRollcall` 的业务逻辑改造，本轮对这些页面保持只读检查。

## 6. 后续建议
- 在 iPhone 刘海屏、底部横条设备和常见安卓窄屏机型上重点回归 `index`、`studentHome`、`teacherHome`、`teacherApply`。
- 重点复测二次进入、前后台切换、扫码返回后的状态刷新是否稳定。
- 若剩余问题集中在单页局部布局，再按页面做更细粒度样式补丁，不建议继续扩大到全局重构。
