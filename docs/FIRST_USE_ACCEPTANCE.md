# 首次接入与静态结果阅读：验收记录

日期：2026-09-24。对应[实施方案](./NEXT_PRODUCT_PLAN.md)。状态：本期工程工作已完成，已确认阻断全部关闭；陌生用户阅读效果待验证。

本轮只处理已经证实的接入障碍，没有扩展功能或整体换肤。六项阅读任务内部走查通过，**不等于陌生用户研究通过**。

## 已确认问题与处理

| 编号 | 证据与影响 | 处理与复验 |
| --- | --- | --- |
| S1：导入被示例加载阻塞 | 修改前分别拦截一个示例为 404、损坏 JSON、持续等待，三种情况下“打开运行记录”均未启用 | 核心初始化不再等待示例；文件、粘贴、拖放分别成功打开自带记录。示例状态只在选择器附近反馈 |
| S1 相邻边界 | 示例迟到、语言切换可能覆盖用户已经开始的阅读 | 复验已接受原记录、选中步骤、未应用草稿保持不变；迟到响应不自动打开示例。真正的核心脚本失败仍禁用导入并给出中英不可用状态 |
| D1：入口推荐与实现脱节 | 完整组件靠后；中文范围/绘图规则和两种语言的检索说明不准确 | 中英统一为“本地 JSON → 完整嵌入 → 低层画布 → Recorder”路线；修正局部路径、500 节点阈值、结构字段检索；保留精度、安全及采集边界 |
| D2：Go 接入片段衔接不清 | Recorder 片段和保存片段重复声明，手工投影示例后有无效尾行，失败记录保存时机不够明确 | 保存块复用同一 Recorder，在返回执行失败前保存；执行错误与采集错误仍分开。删去重复/无效片段，不改 Go 实现 |
| M1：回归入口并发互扰 | 上轮共用构建、服务与报告；本轮独立复核又发现 Playwright 的服务有独立进程组，不能仅凭主组退出就宣布清理完成 | 增加构建前独占锁、独立报告目录、不复用已有服务；异常退出核验与保守恢复见下文 |

修改前副本保存在 [before](../.artifacts/first-use/before/)，没有删除业务记录或现有 P0/P1/P2 断言。
新增的浏览器用例只有一条 P1，覆盖独立的示例故障隔离风险；三个故障分支和核心失败收在同一条用例中，不铺组合矩阵。

### S1 同条件前后证据

同为 Chromium、1280×720、中文首开、同一示例请求返回 404，未打开用户记录：

- [修改前：导入被禁用](../.artifacts/first-use/startup-before/startup-isolation-optional-4294d--replace-an-imported-record-chromium/missing-opening.png)
- [修改后：导入可用，示例就近报错](../.artifacts/first-use/browser-final/startup-isolation-optional-4294d--replace-an-imported-record-chromium/missing-opening.png)

修改前记录见 [startup-before.json](../.artifacts/first-use/startup-before.json)：同一用例的三个软断言分别复现三个故障分支。修复后的独立三引擎检查为 3/3，随后最终产品代码又通过下述 600 项回归。前测里的旧版核心资源拦截诊断不作为额外产品缺陷计数。

## 六项阅读任务

方法：先核对原始记录及已有独立事实断言，再通过浏览器操作核对结果、路径、详情和来源；没有用 UI 值反推评分答案。工作台主要视口为 1280×720。

| 任务与固定记录 | 内部走查答案及操作 | 结果 |
| --- | --- | --- |
| 整次结果：`eino-agent-recorder-trip-planner-completed-v1` | 首屏最终建议东京，执行成功、21 ms；选择东京 `get_weather` 可见 Tokyo 输入以及晴、24°C、降雨 10% 的输出。耗时来自 `evidence[0]` 开始至 `[21]` 结束，差值 21 ms，不是步骤相加 | 正确、可达；[截图](../.artifacts/first-use/success-detail-1280.png) |
| 简短失败子任务：`eino-agent-recorder-trip-planner-failure-completed-v1` | 整次失败、16 ms；摘要一次点击定位 `get_air_quality`，输入 Tokyo、原错误含 `air quality provider timed out`。该步骤耗时未记录，未用运行耗时替代 | 正确、一步可达；[1280 图](../.artifacts/first-use/agent-failure-1280.png)、[390 图](../.artifacts/first-use/agent-failure-390.png) |
| 复杂失败：`workflow-parallel-join-failed` | 摘要一次点击进入 Inventory subtotal 的 `inventory lookup failed`；输入 quantity=3、requestId=order-42、unitPrice=7。Shipping quote 已成功返回 amount=8；join/finish 没有执行事实，未显示成成功步骤，最终结果未记录 | 正确、一步可达；[截图](../.artifacts/first-use/workflow-failure-1280.png) |
| 根/子调用：`agent-deep-nested-failure-recovered` | 根最终值为 `parent final: accepted middle fallback`；中层返回 `middle result: recovered with local fallback`；叶层为 `deep lookup rejected: failure`、输出未记录。展开两级目录进入叶层，再用面包屑回父级和全部步骤，各自结果分开 | 正确、无需重新搜索；[截图](../.artifacts/first-use/deep-scope-1280.png) |
| 重复访问：`graph-multistep-loop-failed` | `evaluate` 第一次成功，round=1、score=60、revise；第二次失败，原错误为 `route evaluation unavailable at round 2`，输入 round=2、score=0、draft。两次访问独立，无错误提升为根最终答案 | 正确；[截图](../.artifacts/first-use/graph-loop-1280.png) |
| 证据不足：`graph-io-oversized`，辅以 `graph-io-redacted`、`workflow-definition-only` | 超限记录执行成功但部分采集，输出未记录且原因是大小限制；脱敏记录显示已脱敏；仅定义记录显示没有执行记录、耗时/I/O 未记录。三者不等同于界面正文折叠 | 正确，未发现需补造事实的空间 |
| 完整原文：`graph-io-long` | 结果展开→实际复制→来源定位；剪贴板 6,600 字符与 `evidence[9].payload.body` 完全相等。来源指向原始证据 #10，没有把预览当完整正文 | 正确、原值未变 |

表中包含计划指定的简短失败子任务，因此为七行、六类任务。Weather 成功和简短失败没有换成更容易的样例。

所有操作均由开发代理执行：是否需要陌生读者提示、首次正确答案用时、误入/返回次数的**人类数据未采集**。不把代理操作时间或工具等待换算为 10/90/120 秒目标成绩。中英语义、语言切换上下文和更多尺寸继续由已有回归保护；本轮未改响应式规则。

### 三入口复核与文档接入

- 工作台：文件选择、粘贴和已有示例选择实际打开记录；六类任务如上。
- 完整嵌入：按 README 的包入口、样式、容器和 `createEinoRunViewer` 示例生成本地消费页。1000px 容器实际完成创建、路径/详情、来源、跨 Graph/Workflow 更新、拒绝无效更新且保留原记录、重复销毁；[接入截图](../.artifacts/first-use/embedded-1000.png)。
- 嵌入另复核失败一步定位、三层调用返回与根结果分离、长正文 6,600 字符复制及 #10 来源；[失败](../.artifacts/first-use/embedded-failure-1000.png)、[局部调用](../.artifacts/first-use/embedded-scope-1000.png)。
- 离线版复核相同三条路径，长正文也与原值完全相等；[失败](../.artifacts/first-use/portable-failure-1280.png)、[局部调用](../.artifacts/first-use/portable-scope-1280.png)。人工代理走查使用本地 HTTP 打开生成的单文件 HTML；直接文件打开及无网络依赖由既有离线版自动回归验证，不混淆两种证据。
- 390×844 选择失败步骤后定位到详情，原错误及 Tokyo 输入可读，页面宽度等于视口宽度。嵌入容器无页面横向溢出。

中英文 JS 示例分别对现有类型做静态核验，API、脚本与文档链接检查通过。消费页只在 `.artifacts/first-use/consumer*`，不属于新增产品功能。Go 文档依据现有接口核验，**本轮未重跑 Go 测试或生成 Recorder fixtures**。

## 验证入口 M1

完整回归运行期间，实际再次调用约定入口，第二次在构建前退出，第一次继续完成；见 [guard-contender.log](../.artifacts/first-use/guard-contender.log)。没有通过终止无关服务或删除别人的报告来抢占环境。

最终保护通过独立代码复核及主线 Node 门禁复跑；见 [guard-final.log](../.artifacts/first-use/guard-final.log)。私有 v2 锁在 Playwright 启动前记录后代清理待确认；管理器正常退出才释放，异常信号/强杀则保留锁。测试真实创建独立进程组的假服务，确认三种强杀方式均不会在服务仍存活时放行重入或自动恢复；成功、普通失败、完成自身清理的优雅中断仍释放。

异常状态、旧锁或归属不明的锁需要任务所有者人工核查；不宣称只看父 PID 就能确认所有后代安全退出，也不提供按锁龄强删。恢复规则以 [测试维护说明](../tests/README.md#浏览器回归防重入m1) 为准；只保护约定入口，不承诺拦截绕过入口的手工命令。进程组行为在本机 macOS 验证，不冒充跨平台进程管理验证。

最终 v2 入口又实际完成构建及启动隔离用例三引擎 **3/3** 复验；见 [entry-final.json](../.artifacts/first-use/entry-final.json)。结束后锁已释放、4173 临时服务已退出。600 项产品完整回归在这次仅涉及验证脚本的补丁前完成，产品代码未再改变；两份结果分开记录，不把 3 项复验说成第二次完整回归。

## 回归结果

| 检查 | 本轮结果与证据 |
| --- | --- |
| JS 产品测试 | 20 个入口通过；[日志](../.artifacts/first-use/js.log) |
| 语法 | 通过，包含最终产品修改后的复检；[日志](../.artifacts/first-use/check-final.log) |
| 类型 | 通过；[日志](../.artifacts/first-use/types.log) |
| 32 场景严格检查 | `passed-with-limitations`；四项既有边界保留；[日志](../.artifacts/first-use/matrix.log) |
| 默认完整三引擎 | **600/600**：Chromium 254、Firefox 173、WebKit 173；失败/跳过/flaky 均为 0；[报告](../.artifacts/first-use/browser-final.json)、[日志](../.artifacts/first-use/browser-final.log) |
| 最终验证入口 | Node 进程门禁通过；最终 v2 入口三引擎 3/3 通过，正常退场及锁释放已检查 |

当前独立浏览器场景为 254：P0 169 / P1 75 / P2 10 / P3 0。81 个数据组合继续使用已确认的浏览器分工；没有恢复三引擎重复数据矩阵。600 次与上轮 597 次的差异只来自新增 P1 的三个引擎执行，不弱化任何事实断言。

## 剩余问题与停止决定

- 六项内部任务未发现值得新增布局改造的阅读阻断，按计划跳过额外 UI 开发，不凑三个优化名额。
- 人类 10 秒成功/失败、90 秒复杂失败、120 秒层级阅读目标均为**待验证**；没有陌生用户数据，不宣布“产品已优秀”。后续由 Owner 协调未参与实现的开发者，获得同意后再开展；本轮未联系任何第三方。
- 四项事实边界不变：`graph-step-limit`、`graph-cancelled` 旧记录缺节点正文；`graph-io-oversized` 省略超限正文；`agent-nested-parallel-scopes` 部分事件身份不足。查看器不猜结果和归属。
- 未修改 Recorder、fixtures、公共 API/类型或上游代码；没有实时、流式、恢复、服务化或发布。上游 `eino-workflow-dag` 工作区仍干净，HEAD 为 `286f3d7ad5127096d84d25d09af77ace53ccd017`。

工程阻断已全部关闭，本期转入反馈驱动维护。只有实际阅读问题、具体大记录性能证据或安全可用的新项目记录，才触发后续开发，不继续按测试数量和改动数量推动迭代。
