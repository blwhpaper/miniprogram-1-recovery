# UI Style Mapping

## 页面映射

| 设计稿页面 | 现有页面 | 应复用的公共类 | 后续处理级别 | 当前状态 |
| --- | --- | --- | --- | --- |
| Index | `pages/index/index` | `ui-page` `ui-page--center` `ui-card` `ui-hero-card` `ui-section` `ui-title-lg` `ui-text-body` | 低 | 本轮仅建立映射 |
| TeacherHome | `pages/teacherHome/teacherHome` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-page-head` `ui-tag` `ui-panel-card` `ui-button-group` `ui-info-list` | 中 | 本轮仅建立映射 |
| StudentHome | `pages/studentHome/studentHome` | `ui-page` `ui-page--stack` `ui-hero-section` `ui-hero-pill` `ui-card` `ui-panel-card` `ui-action-grid` `ui-action-tile` `ui-info-list` `ui-notice-card` | 中 | 本轮已接线 |
| ClassManager | `pages/classManager/classManager` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-record-list` `ui-record-card` `ui-btn-ghost` `ui-empty-state` | 低 | 本轮仅建立映射 |
| ClassHome | `pages/classHome/classHome` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-notice-card` `ui-info-list` `ui-empty-state` | 低 | 本轮仅建立映射 |
| SignRecord | `pages/signRecord/signRecord` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-stat-grid` `ui-stat-card` `ui-chip-card` `ui-record-list` `ui-record-card` `ui-tag` `ui-btn-pill` | 中 | 本轮仅建立映射 |
| ClassInteraction | `pages/classInteraction/classInteraction` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-chip-card` `ui-record-list` `ui-record-card` `ui-tag` `ui-record-actions` | 高 | 后续需结构调整 |
| RandomRollcall | `pages/randomRollcall/randomRollcall` | `ui-page` `ui-page--stack` `ui-page--with-bottom-bar` `ui-hero-section` `ui-hero-pill` `ui-card` `ui-panel-card--focus` `ui-bottom-bar` `ui-chip-card` `ui-record-list` | 中 | 本轮已接线 |
| StudentSign | `pages/studentSign/studentSign` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-feedback` `ui-card--subtle` `ui-button-group` `ui-btn-pill` | 中 | 本轮仅建立映射 |
| StudentQuestion | `pages/studentQuestion/studentQuestion` | `ui-page` `ui-page--stack` `ui-page--with-bottom-bar` `ui-hero-section` `ui-hero-pill` `ui-card` `ui-panel-card` `ui-feedback` `ui-bottom-bar` `ui-empty-panel` | 中 | 本轮已接线 |
| StudentList | `pages/studentList/studentList` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-button-group` `ui-info-list` | 低 | 本轮仅建立映射 |
| Register | `pages/register/register` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-form-card` `ui-form-item` `ui-form-label` `ui-input` | 低 | 本轮仅建立映射 |
| TeacherApply | `pages/teacherApply/teacherApply` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-form-card` `ui-form-item` `ui-input` `ui-textarea` `ui-tag` | 低 | 本轮仅建立映射 |
| AdminTeacherReview | `pages/adminTeacherReview/adminTeacherReview` | `ui-page` `ui-page--stack` `ui-card` `ui-hero-card` `ui-panel-card` `ui-form-card` `ui-input` `ui-record-list` `ui-record-card` `ui-button-group` `ui-tag` | 低 | 本轮仅建立映射 |

## 页面处理口径

### 本轮已接线

| 页面 | 已完成内容 | 后续口径 |
| --- | --- | --- |
| `pages/studentHome/studentHome` | 已接入蓝色 Hero、白卡承载、操作宫格映射 | 后续只继续复用公共类，不回退到页面私有按钮样式 |
| `pages/studentQuestion/studentQuestion` | 已接入单按钮请求页、神灯主视觉承载、底部固定操作栏 | 后续只允许围绕请求状态和视觉收口，不得改成输入框或消息流 |
| `pages/randomRollcall/randomRollcall` | 已接入 Hero、中心舞台卡、双骰子视觉、底部固定主操作栏 | 后续只允许补动画/视觉一致性，不改原评分与记录链路 |

### 本轮仅建立映射

| 页面 | 映射口径 |
| --- | --- |
| `pages/index/index` | 保持极简入口页，用现有 `ui-page` + `ui-hero-card` 体系即可 |
| `pages/teacherHome/teacherHome` | 延续现有教师 Hero 和信息卡，后续继续用 `ui-panel-card`、`ui-button-group` 收口 |
| `pages/classManager/classManager` | 保持信息卡片列表页方向，继续用 `ui-record-card` 和浅语义按钮 |
| `pages/classHome/classHome` | 保持课堂状态卡 + 操作入口卡方向，继续用 `ui-panel-card`、`ui-notice-card` |
| `pages/signRecord/signRecord` | 保持统计卡 + 历史课次 + 学生记录卡方向，继续用 `ui-stat-grid`、`ui-record-card` |
| `pages/studentSign/studentSign` | 保持大按钮强引导方向，继续用 `ui-feedback`、`ui-panel-card`、`ui-button-group` |
| `pages/studentList/studentList` | 保持列表管理页方向，继续用 `ui-hero-card` + `ui-button-group` |
| `pages/register/register` | 保持标准表单页方向，全部走 `ui-form-card` + `ui-input` |
| `pages/teacherApply/teacherApply` | 保持申请表单页方向，全部走 `ui-form-card` + `ui-tag` + `ui-textarea` |
| `pages/adminTeacherReview/adminTeacherReview` | 保持审核列表页方向，全部走 `ui-record-card` + `ui-button-group` |

### 后续需结构调整

| 页面 | 调整原因 | 调整边界 |
| --- | --- | --- |
| `pages/classInteraction/classInteraction` | 现状仍混有“测试发布/作答结果/互动记录”承载，离“提问请求管理列表页”表达不够纯 | 后续只做结构收口到“概览卡 + 请求列表 + 允许/稍后”，不改接口主链路 |

## 公共类使用约束

- 禁止继续在页面 `.wxss` 中写死主色、页面背景色、卡片背景色；统一使用 `app.wxss` 中的全局变量。
- 优先复用 `app.wxss` 已有公共类，例如 `ui-page`、`ui-card`、`ui-panel-card`、`ui-button-group`、`ui-tag`、`ui-feedback`、`ui-bottom-bar`。
- 能直接套公共类实现的样式，不要重复造页面私有类；页面私有样式只允许补局部布局差异，不允许再定义一套按钮、卡片、输入框皮肤。
- Hero、卡片、标签、输入框、底部操作栏等基础视觉语言，后续页面必须先从公共类中选型，再决定是否补最小页面样式。
