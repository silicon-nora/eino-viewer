# 产品体验精修：专业阅读工作台

日期：2026-09-23。状态：本轮已实现并通过验收。范围：已保存的 Eino 结果阅读，不增加执行能力。

## 本轮实现

- 首次打开不自动加载示例。文件、拖放、粘贴为主入口；示例按 Agent / Graph / Workflow 分组，切换分类不替换当前记录。
- 最终结果或失败原因在前，调用与步骤在侧栏，路径为主区；选中步骤后才打开浅色详情。
- 按容器宽度适配三栏、下置详情和单列布局；嵌入组件不依赖宿主窗口宽度。
- 子调用使用局部结果与面包屑，整次结果收为摘要条；同名调用保留真实来源身份，可展开和复制完整身份。
- 工作台、完整嵌入组件和离线版共享展示名称、术语及 Workflow 阅读次序。Graph / Agent 不套用 Workflow 排序，公共搜索与规范节点顺序不变。
- 详情按错误或输出、输入、技术来源阅读。长正文预览不超过六行，展开与复制保留完整原值；缺失、脱敏、截断分别表达。
- 错误有唯一有效步骤关联时可直接定位；跳转同步目录、图和详情，仅清除遮住目标的过滤。
- 语言切换保留范围、查询、分页、选择、展开状态、证据、未应用草稿、阅读位置及图的视口；关闭详情保留选择并恢复键盘焦点。
- 无效导入不替换当前记录；新记录成功打开后清除旧阅读状态。复制反馈就近出现，不改变布局。
- 三处均按完整阅读范围执行 500 / 501 节点绘图保护；空范围不创建图，手动折叠不会被搜索或选择打断。隐藏挂载、更新、销毁和多实例隔离有回归覆盖。

未修改 Recorder、原始记录、记录格式、公开 API、上游仓库或发布流程。`createEinoViewer` 仍是低层入口；语言与图状态控制桥仅在包内使用。Agent 的完成态重放保留。

## 六项用户任务

| 用户任务 | 实际检查与证据 |
| --- | --- |
| 短记录首屏识别结果、状态并进入路径和步骤 | 1280×720 的多城市出行 Agent，结果、状态、耗时与路径同时可见；步骤侧栏无需先展开搜索面板。见同记录对照。 |
| 一次操作进入明确失败步骤的错误与输入 | 后期失败 Agent、Workflow 失败及跨子调用的传播失败；摘要动作定位精确来源步骤，清除阻挡过滤，保留原始错误及输入。关闭详情后焦点返回原动作。 |
| 三层调用中辨认当前位置、父级与整次结果 | 真实 `agent-deep-nested-distinct-results`：根结果 `parent final: accepted single`、中层 `middle result: reviewed single`、叶层 `leaf result: verified single` 不串台；面包屑返回，根结果折叠可展开。 |
| 同名调用指向一致，Workflow 前驱先于后继 | 目录、图和详情使用同一真实身份；并行 Workflow 阅读为 prepare → fast / slow → join → finish，同层稳定源序不代表真实并发。保留规范顺序与公共搜索断言。 |
| 切语言、开合详情、展开原文不丢上下文 | 覆盖选择、范围、分页、证据、Raw 草稿、展开状态、图的缩放和平移；程序同步不伪造图点击，宿主回调不因切语言重复。 |
| 三入口术语一致、技术字段按需、无遮挡溢出 | 四种视口和独立 1000px 嵌入容器；中英、键盘、长名称、无结果搜索、复制失败、无效导入及 500 / 501 边界。几何断言验证列宽、顺序、选中节点可见与页面无横向溢出。 |

## 视觉证据

同一多城市出行 Agent，同为 1280×720，均未选中步骤：

- [精修前](../.artifacts/product-refinement/before-agent-1280.png)
- [精修后](../.artifacts/product-refinement/after-agent-1280.png)

三入口使用同一真实 `graph-io-structured` 记录、选中同一末步，截图由浏览器回归保存：

| 视口 | 工作台 | 嵌入 | 离线 |
| --- | --- | --- | --- |
| 1440×900 | [截图](../.artifacts/product-refinement/after-workbench-1440x900.png) | [截图](../.artifacts/product-refinement/after-embedded-1440x900.png) | [截图](../.artifacts/product-refinement/after-portable-1440x900.png) |
| 1280×720 | [截图](../.artifacts/product-refinement/after-workbench-1280x720.png) | [截图](../.artifacts/product-refinement/after-embedded-1280x720.png) | [截图](../.artifacts/product-refinement/after-portable-1280x720.png) |
| 768×1024 | [截图](../.artifacts/product-refinement/after-workbench-768x1024.png) | [截图](../.artifacts/product-refinement/after-embedded-768x1024.png) | [截图](../.artifacts/product-refinement/after-portable-768x1024.png) |
| 390×844 | [截图](../.artifacts/product-refinement/after-workbench-390x844.png) | [截图](../.artifacts/product-refinement/after-embedded-390x844.png) | [截图](../.artifacts/product-refinement/after-portable-390x844.png) |

断点依据查看器容器宽度，而不是整个浏览器宽度。768px 视口扣除页面留白后可能进入单列；另用 1440px 宿主内的 1000px 嵌入容器验证 220px 侧栏与下置详情。

另见[真实失败的一步定位](../.artifacts/product-refinement/after-failure-detail-1280.png)：图中失败步骤与浅色详情同步，错误预览可展开，原输入保留。

## 回归结果

验收构建标识：`fc6a6dbe51e3`。最终冻结版本 **780 / 780 通过**：Chromium、Firefox、WebKit 各 260 项，失败、跳过、不稳定重试均为 0。耗时 6 分 49 秒。中间失败和中止轮次不计为验收通过。

[最终执行日志](../.artifacts/product-refinement/browser-final.log) · [完整机器报告](../.artifacts/product-refinement/browser-final.json)

- `npm run check`、`npm run typecheck`：通过。
- `npm test`：20 个 JS 测试入口通过。
- `node scripts/inspect-recorder-matrix.js --strict`：32 个真实 Recorder 场景通过既定严格门禁，保留下述四项既有限制。
- 运行时公开导出逐项匹配 `API_SURFACE.json`，未新增公开控制参数或类型。
- 工作台与离线构建通过；12 张三入口、多尺寸截图全部在最终回归开始与结束之间生成。
- 上游 `eino-workflow-dag` 未修改，最终工作区仍干净，HEAD 保持 `286f3d7`。未发布或部署。

走查实际发现并修复了语言切换时的 Raw/选择状态、底层重新布局引起的视口偏移、详情展开后选中节点越界、短正文窄栏换行不折叠，以及带内边距的结构化预览漏出第七行等问题。行数验收同时检查实际可见文字行，而不仅是样式属性。

WebKit 完整回归还发现工作台在尺寸观察回调中同步绘图引发布局循环。旧构建原样重复 40 次中复现 12 次；修复将绘图合并到下一帧，原样重复 **40 / 40 通过**，不屏蔽浏览器错误，也不修改事实断言。见[修复前](../.artifacts/product-refinement/resizeobserver-repeat.log)与[修复后](../.artifacts/product-refinement/resizeobserver-repeat-fixed.log)。SDK 与离线版原本采用延帧调度，不做重复改动。

真实矩阵和 Recorder 未增加或重写；500 / 501、240 字窄栏换行等为明确的 UI 边界派生测试，不计入真实 Recorder 场景数量。本轮没有重跑 Go 执行测试，不把历史 Go 测试结果计作本轮新验收。

## 剩余边界

本计划范围内没有已知未修复的验收阻断。上述六项用户任务已通过开发者走查及对应回归。

32 场景严格检查保留既有四项限制，本轮不修改采集事实来消除它们：

1. `graph-step-limit`：旧记录缺少节点 I/O 正文。
2. `graph-cancelled`：旧记录缺少节点 I/O 正文。
3. `graph-io-oversized`：两份正文因采集大小限制主动省略。
4. `agent-nested-parallel-scopes`：并行子 Agent 事件缺少足够的调用身份，不能可靠归入某次调用；保留为未确认范围证据。

本次是开发者自测、真实 Recorder 记录走查及自动回归，不是陌生用户研究，也不证明所有 Eino 应用场景均已穷尽。后续优先收集实际阅读反馈，不默认扩展一级功能、实时、流式、恢复或发布。
