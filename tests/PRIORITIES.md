# 测试优先级

## 判定标准

| 等级 | 风险与保留理由 |
| --- | --- |
| P0 | 数据安全、原值/类型、身份与来源、真实状态和结果、不可变性、关键公开 API 契约。失败会让结果不可信、输入不安全或集成失效。 |
| P1 | 核心阅读流程：打开记录、查看结果、路径与步骤、范围导航、键盘操作、阅读上下文、可靠挂载与已知浏览器缺陷回归。 |
| P2 | 次要交互和合法边界：披露状态、文案、预览阈值、大记录有界渲染等。仍有独立、明确的失败判据。 |
| P3 | 过时或零独立覆盖的重复检查、不能失败的自我比较、只验证演示辅助代码的业务规则，以及没有门槛的性能采样片段。删除，不用跳过或降低执行频率代替。 |

优先级不是浏览器分工：`@P0` 也可以同时是 `@data-matrix`，其完整数据组合在 Chromium 检查，交互机制另有三引擎保护。低频、异常输入、多语言、仅定义记录、采集缺失、脱敏和 Unicode 不因少见而成为 P3。一个用例同时承担多类风险时，取最高风险等级。

## 浏览器用例

每个保留的 Playwright 用例都有且只有一个 `@P0`、`@P1` 或 `@P2` 标签，参数化产生的每个场景继承该标签。具体归级与用例放在一起，避免另一份标题列表失去同步。

```sh
# 查看任一级的具体用例；不启动浏览器
npx playwright test --list --grep @P0
npx playwright test --list --grep @P1
npx playwright test --list --grep @P2

# 构建并运行某一级；完整验收仍运行全部保留用例
npm run test:browser -- --grep @P0 --workers=4
```

P0 主要是跨入口事实保真、原始输入安全、错误与正文的独立归属、公开接口和原始记录导出；P1 主要是结果优先布局、路径/范围/步骤联动、键盘和焦点、语言上下文、图挂载与销毁；P2 主要是次要披露状态、页面文案策略和有界的大记录检查。曾捕获 WebKit ResizeObserver 问题的声明 Workflow 和轨迹切范围测试仍保留三引擎。

## Node 与类型测试

现有 Node 测试是顺序断言脚本，没有把每个断言注册为单独用例。以下按现有测试组分级；入口主级取最高风险，不把循环次数或断言条数包装成独立用例数。P1/P2 子组随同一入口继续执行。

| 测试入口 | 主级 | 场景与低级子组 |
| --- | --- | --- |
| `component-protocol.test.js` | P0 | omitted/null/empty、禁止读取流正文、协议保真；组件目录正例 P1 |
| `run-record.test.js` | P0 | 单次运行边界、真实结束状态、不变性、非法记录拒绝 |
| `recorder-matrix.test.js` | P0 | 32 个真实记录、独立来源校验及评估器的变异负例 |
| `complex-graph-workflow.test.js` | P0 | 每次 Graph 访问、Workflow 并行依赖、输入输出与失败停止 |
| `views.test.js` | P0 | 无损原对象、run 关联、非法输出拒绝；注册/卸载/选择与 fallback 路由 P1 |
| `viewer.test.js` | P0 | 输入拒绝、canonical 保真、真实状态、仅定义不伪造执行；适配与双语呈现 P1 |
| `domain-views.test.js` | P0 | 原 payload、run 分组、非法 envelope 索引；域路由 P1 |
| `negative-domains.test.js` | P0 | 非法协议、域、流正文及混合输入的拒绝与诊断 |
| `execution-dag.test.js` | P0 | 身份、嵌套、边、错误归属、状态、时间；既有 builder/adapter 可组合性 P1 |
| `trajectory.test.js` | P0 | 回合、重复调用、多层同名、失败恢复、结束边界；既有 builder 兼容 P1 |
| `trajectory-reading.test.js` | P0 | 轨迹与步骤的唯一身份关联、完整调用范围、来源与原值保真；同号回合分组和双语名称 P1 |
| `explanation.test.js` | P0 | 根/步骤/局部结果、来源、采集状态、声明与观测区别；全域/双语 P1，次要文案 P2 |
| `inspection.test.js` | P0 | 范围隔离、证据保留、不索引正文、不伪造调用身份；搜索分页 P1，合法越界参数 P2 |
| `scope-reading.test.js` | P0 | 32 场景的局部结果、原边、未归属与不变性；面包屑/声明子树阅读 P1 |
| `renderer-presentation.test.js` | P0 | 状态与耗时来源、真实调用编号与完整身份；双语命名/键盘可读性 P1 |
| `reading-presentation.test.js` | P0 | 不改自定义名称和正文、不虚构依赖次序；三入口统一术语 P1，词典精确文案 P2 |
| `rendered-value-fold.test.js` | P1 | 隐藏/显示、宽度变化、观察器、取消与销毁；像素阈值与无浏览器环境 P2 |
| `content-presentation.test.js` | P0 | 原值和数字文本、source role、采集与错误归属；预览长度和 Unicode 边界 P2 |
| `run-viewer.test.js` | P0 | 副本所有权、事务更新、输入安全、公开接口与异步竞争；阅读流程 P1，披露与阈值 P2 |
| `json-input-boundary.test.js` | P0 | 精度、getter/cycle、深度/值数/字节界限、非可执行输入；合法大输入 P2 |
| `record-input.test.js` | P0 | 原始数字 token、精度、恶意键按数据处理、输入资源界限；合法数值写法与提示 P2 |
| `types.test.ts` | P0 | 已有公开入口、返回结构、回调和状态类型的编译契约；编译失败就是判据 |

真实 Recorder fixtures 是测试输入，不是独立执行次数。32 份记录继续支撑 P0 的采集/投影/保真验证，也被 P1/P2 的界面用例复用，不因删除重复 UI 用例而删除这些记录。既有 builder 和“不消费流”的安全边界是现有契约，不代表新增实时或流式界面。

## Go 测试

每个文件内的 `Test…` 函数及其子用例继承主级，具名例外在下表注明。混合验证中的低风险断言继续随最高风险测试保留。26 个主模块测试文件与 1 个独立 live 模块均纳入评估。

| `integrations/go/` 下的测试文件 | 主级 | 主要风险 / 具名例外 |
| --- | --- | --- |
| `agent_events_test.go` | P0 | 不消费流、拒绝不安全值；`TestAgentEventEnvelopesMatchSharedFixture`、`TestAgenticEventProjectionPreservesMaterializedMessage` 为 P1 官方事件格式兼容 |
| `agent_recorder_test.go` | P0 | 根输入/最终结果、失败/未完成不造输出、证据副本、nil runner 契约 |
| `callback_events_test.go` | P0 | 调用地址、eventId/parentId、次序、错误及副本 |
| `complex_agent_matrix_test.go` | P0 | 同名并行反序、重复回合对应实际调用与输入输出 |
| `component_io_test.go` | P0 | 采集缺失、自定义数据和流边界；`TestOfficialComponentIOProjectionMatrix` 为 P1 官方组件格式正例 |
| `deep_nested_agent_matrix_test.go` | P0 | 三层同名同 ID、局部恢复与根答案分离 |
| `execution_boundary_test.go` | P0 | 只有结束/子调用时不得编造根开始时间与耗时 |
| `graph_io_test.go` | P0 | 原值、每次访问、输入快照、脱敏/省略、流不消费及根 I/O |
| `graph_loop_matrix_test.go` | P0 | 逐次输入输出、边界、失败停止、未走分支与根结果 |
| `graph_recorder_test.go` | P0 | 循环原证据、旧契约、完成边界、副本与前置条件 |
| `nested_agent_matrix_test.go` | P0 | 并行范围、恢复/传播、子答案不当作根答案、错误安全边界 |
| `numeric_fidelity_test.go` | P0 | Go 原始 64 位数值 token 与根/节点值；不能被 JS 精度测试替代 |
| `parallel_workflow_matrix_test.go` | P0 | 双分支反序、join、失败停止及独立因果反例 |
| `protocol_test.go` | P0 | 脱敏、防御副本、不安全/超限值与未知字段拒绝 |
| `realistic_agent_test.go` | P0 | 跨回合原答案与后期失败；`TestRealisticAgentUsesEinoParallelToolDispatch` 为 P1 实际并行能力 |
| `recorder_fixture_compat_test.go` | P0 | 兼容归一化不得重排、重复、改值或丢失省略事实；不是可删的演示 helper 自测 |
| `recorder_safety_test.go` | P0 | 不执行自定义序列化、不改业务值、脱敏先限额、采集失败不等于执行失败 |
| `run_lifecycle_test.go` | P0 | 耗尽才完成、根与局部错误分离、取消/中断/恢复、采集状态单调 |
| `run_record_test.go` | P0 | 单 run、副本与 JSON 往返、生命周期 schema/次序 |
| `safe_component_io_test.go` | P0 | 安全 fallback、身份脱敏、JSON 保真、省略原因、empty/null |
| `schema_domains_test.go` | P0 | 不安全扩展、脱敏与原对象不变；官方格式正例作为 P1 子组随入口保留 |
| `snapshot_test.go` | P0 | 源边/嵌套、回调路径、真实错误、unfinished/skipped/时间；`TestProjectWithOptionsAddsNodeKindsByFullPath` 为 P1 类型映射兼容 |
| `static_agent_matrix_test.go` | P0 | 真实取消、中断、恢复与脱敏；独立顺序和诊断反例 |
| `static_graph_workflow_matrix_test.go` | P0 | 最大步数、取消、失败后继、同名嵌套、仅定义与乱序证据反例 |
| `weather_agent_scenario_test.go` | P0 | 真正经过 Runner/产品投影的源值、工具失败与缺失输出；天气 helper 自身白名单测试已删 |
| `workflow_recorder_test.go` | P0 | 编译拓扑、执行 I/O、副本、失败/skipped、投影错误回传 |
| `live/live_agent_test.go` | P2 | `TestLiveAgentRecorderWithProvider` 有真实 provider→Recorder 互通判据；独立模块、显式凭据/网络开关，非默认回归，本轮不调用外部模型 |

## 2026-09-24：P3 删除台账

浏览器从 259 个独立场景减少到 **253 个**：P0 **169**、P1 **74**、P2 **10**、P3 **0**。默认三引擎分工下为 **597 次执行**（253 + 172 + 172），而不是把同一场景的三个引擎计作三个独立需求。`@data-matrix` 剩 81 个，完整所有引擎组合为 759 次。

删除的 6 个浏览器 P3 用例，先迁移独有断言，再删除重复测试体：

| 已删除用例 | 保留覆盖及理由 |
| --- | --- |
| `default-samples`：legacy cyclic Graph / weather Workflow 组合 | `eino-viewer-workbench` 的 cyclic Graph 与 Workflow 完整回归；补两份原记录全量深等值，示例选择与具体结构仍保留 |
| `nested-run-viewer`：portable nested inspection 窄屏组合 | `scope-run-viewer` 的 portable narrow local results；补英文切换、键盘选步骤、父级最终结果、无效导入后选中身份保持 |
| `inspection`：`agent-parallel-same-tool` 参数 | `step-identity-reading` 的同 fixture / workbench 场景；补技术来源默认关闭。顺序重复工具参数仍保留 |
| `reading-content`：arbitrary tool objects | 实际传入的是序列化后的字符串，并非独立对象路径；完整业务键合入 JSON-looking tool text，用同两视图检查 exact text/type/原记录 |
| `static-result-summary`：definition-only Workflow 摘要 | `reading-status` 同 fixture 回归；补全部结果、capture unknown、缺失 I/O 断言，原 WebKit 缺陷保护仍三引擎运行 |
| `reading-workbench`：call directory fold | `nested-workbench` 同 fixture；补默认展开、搜索可见、关闭详情后折叠仍保留完整 scope 与 linkedSelection |

另外从 `inspection` 与 `run-viewer` 的大记录用例删除两处没有通过/失败门槛的计时、堆内存、UA 采样及 JSON 写盘片段。两个 P2 功能用例本身仍保留：100/1000/10000 规模、绘图保护、分页、精确 Raw、按需生成原文与 DOM 数量上限没有删。`inspection` 的保留用例改名为 `large records defer graph drawing and keep evidence navigation bounded`，属于重命名，不另算新增或删除。单独的 `benchmark:static` 是手动诊断工具，不冒充回归测试，也不纳入本次用例计数。

Node 删除/合并 **7 组** P3 冗余场景或断言（不是 7 个独立测试入口）：

1. `record-input` 对同一个字符串参数的前后自比较：字符串不可变，不能验证运行对象保真。
2. `record-input` 重复检查三个输入限制常量：`json-input-boundary` 已精确检查整个对象及冻结状态。
3. `viewer` 重复的零耗时样例：`renderer-presentation` 已覆盖 recorded boundaries、0ms、无效时钟与源不变。
4. `domain-views` 重复的空 registry fallback：合并入 `views`，补 `.ok === true`，保留完整原断言。
5. `record-input` 在完整深等值后重复检查三个字段的 `typeof string`。
6. `record-input` 两处重新读取 fixture 与原文本比较：解析器只收到文本、不接收路径；真实数字 token、类型和拒绝精度丢失检查保留。
7. `reading-presentation` 在两语词典完整深等值后重复检查键数量。

Go 删除 **2 组** P3：

- `TestWeatherToolRejectsInvalidInputs`（含 2 个子例）只验证测试 helper 的 JSON 错误文本和硬编码城市白名单，不经过产品代码，也不生成 fixture；真实 Runner 工具失败与“不虚构最终输出”仍保留。
- `snapshot_test.go` 在 `json.Marshal` 已无错误后再次 `json.Valid` 的标准库保证重复检查；可序列化及错误检查保留。

上述 P3 均从运行源码中实际删除，不使用 `skip`/`fixme`，也不只是给它们换优先级或少跑浏览器。未删除整个测试文件。改前副本保存在 `.artifacts/test-priorities/before/`，可恢复。

## 后续维护规则

新增浏览器测试必须明确标一个优先级；合并或删除时写明风险由哪个保留用例承担。涉及新风险时升级用例，不因测试慢或结果失败而降为 P3。事实、安全与 mutation gate 不用“另一层已经绿了”作删除理由。

浏览器验收使用独占服务器，多个运行不要共用默认产物目录；需要并行开发时只并行代码审查和 Node 检查，将浏览器回归串行执行。最终验收报告与被环境干扰的中途尝试分开保存。

### 首次接入阶段 M1：验收入口防重入

`npm run test:browser` 已增加覆盖构建到 Playwright 退出的独占入口；第二任务不进入构建。
默认使用每次独立的 trace/output 目录，不借用现有 4173 服务，不清理其它任务的报告。
正常/失败/中断释放与强制退出残留的核验恢复方式见[维护说明](README.md#浏览器回归防重入m1)。
Playwright 独立 webServer / 浏览器进程组有额外的清理不确定性门禁：异常信号、强杀升级或入口被强杀留下的 `pending` / `uncertain` 锁不自动恢复，不能把父进程组退出等同于全部后代退出。Node 门禁包含真实 detached 假服务的正反例，不依赖实际浏览器或监听端口。
`scripts/run-browser-tests.test.js` / `npm run test:browser:guard` 属 P1 工程可靠性门禁，
含进程身份、异主机/未知锁不清理的安全边界；它使用假步骤，不计入 20 个产品 Node 入口或浏览器场景数。
本轮另新增示例故障隔离 P1，当前浏览器清单为 254 个独立场景（P0 169 / P1 75 / P2 10），默认 600 次执行；下述 597 次仍是上一轮历史验收，不改写为本轮结果。

## 本轮验收结果

以下保留 P3 清理阶段的历史结果；首次接入阶段结果见下一节。

- 浏览器独占完整回归 **597 / 597 通过**：Chromium 253、Firefox 172、WebKit 172；无失败、跳过、重试或 flaky。每个用例都有唯一优先级，运行清单中无 P3。
- 20 个 JS 入口、语法、类型、Go 主模块完整测试与 32 场景严格检查均通过。独立 live provider 测试未运行，四项既有采集限制不变。
- 生产源、页面和全部 fixtures 内容未改；Go 仅修改两个测试文件。上游 `eino-workflow-dag` 仍干净且 HEAD 未变。
- 最终报告：`.artifacts/test-priorities/browser-final.json`。第一次尝试与小范围检查曾因并发测试任务共用服务器/产物目录出现连接中断和 trace 文件缺失，已停止受干扰运行、换独立产物目录完整重跑；这些中途结果不计入全绿验收，也未通过放宽断言处理。

## 2026-09-24：首次接入阶段复验

- 新增一条独立 P1：示例请求缺失、损坏或迟到不得阻塞导入或替换已接受记录；同时保留真正核心不可用的边界。没有扩张数据组合矩阵。
- 最终产品完整回归 **600/600**：254 + 173 + 173；失败、跳过、flaky 均为 0。P0 169 / P1 75 / P2 10 / P3 0。
- JS 20 个产品入口、语法、类型及 32 场景严格检查通过；本期仅改 Go 文档，没有重跑 Go 或重新生成 fixtures。
- M1 最后补丁的 Node 进程门禁通过；最终 v2 入口另跑启动用例三引擎 3/3，锁及临时服务均正常释放。完整 600 项在仅验证脚本的最后补丁前执行，产品代码未再改变。
- 六项内部阅读任务、三个入口及前后证据见[本期验收](../docs/FIRST_USE_ACCEPTANCE.md)。人类阅读效果仍待验证。

## 2026-09-29：Agent 共享展示核心

- 新增 3 个跨入口场景：P0 两个（原始身份／正文与层级一致、更新销毁和点击回调契约），P1 一个（不同入口及 Agent／Graph 混合挂载的样式隔离）。不恢复已删除的 P3，不扩张 fixture 组合矩阵。
- 本轮不删除或降级既有场景。已移除的 Agent UI 控件断言改为当前可见轨迹操作及所属 API 的事实验证，保留原始记录、来源索引、业务原文与导出断言；Graph／Workflow 既有断言保留。
- 当前 252 个独立案例：P0 172 / P1 70 / P2 10 / P3 0；默认三引擎 594 次执行。既有 data-matrix 的跨引擎策略不变。
- 最终完整运行 593/594：Firefox 大规模 Graph 兼容案例超时，其余通过；同代码、同断言、同门限独立连续复验 3/3。保留并发规模测试稳定性风险，不将该案例降级、跳过或把分次复验写成一次全绿。详情见[本轮验收](../docs/AGENT_TRAJECTORY_ACCEPTANCE.md#2026-09-29三入口共享-agent-阅读核心)。

## 2026-09-29：Graph 工作台体验试版

- 新增两项：P0 校验真实循环成功／失败、重复访问来源、错误直达和语言状态；P1 校验四视口布局及键盘操作。四视口不另计独立案例。
- 当前 254 个独立案例：P0 173 / P1 71 / P2 10 / P3 0。既有 81 个 data-matrix 场景及跨引擎策略不变，旧案例未删除或降级。
- 移除控件的断言迁移至实际可见操作，原始记录、正文、来源索引、循环身份和导出断言保留。编辑草稿由仍保留该功能的 Workflow 入口验证。
- 同一冻结版本分两批完成完整范围验证：Chromium 254/254，Firefox 与 WebKit 346/346，合计 600/600。不是单进程一次执行；最终两批均无失败、跳过或重试。
- 21 个 JS 产品入口、语法、类型和 32 场景严格检查通过，四项既有采集限制保留。未重新采集 fixture，未运行付费 live provider。设计仍待 Owner 验收，详见[Graph 试版说明](../docs/GRAPH_READING_PREVIEW.md)。

### 同日：Graph 重复节点合并

- 浏览器案例仍为 254（P0 173 / P1 71 / P2 10 / P3 0），只扩展原 Graph 场景，不新增排列组合，也不删除或降级事实断言。
- 新增 `tests/graph-reading.test.js`：P0 的身份隔离、原值／边关系保真、失败保留；P1 的安全回退和真实绘图解析兼容性。JS 产品入口增为 22。
- 最终同一版本一次完整运行 600/600，无失败、跳过或重试；JS、语法、类型和 32 场景严格检查通过。既有采集限制未改。
- 中间 WebKit 窄屏上跳修复与旧来源断言修正均保留原始正文、身份和画布要求，最终重新完整验证，详见[合并版验收](../docs/GRAPH_READING_PREVIEW.md#合并版验收)。

### 同日：Graph 定义流程与可见回环

- 独立浏览器案例 255（P0 174 / P1 71 / P2 10 / P3 0）；只新增 `graph-topology-lifecycle` 一个 P0，覆盖新画布的循环／同排障碍／多个自环、文字安全、状态恢复、隐藏尺寸、过期回调与多实例隔离。
- 原 Graph P0／P1 扩展定义节点、条件分支、原始访问及正文、未观测分支、默认名称和自定义名称保留、搜索与语言状态；不重复新增视口／来源排列组合，Agent／Workflow／嵌入原事实断言保留。
- 新增 `tests/graph-topology.test.js`，7 组纯模型验证；JS 产品入口为 23。
- 最终一次三浏览器 603 / 603、JS、语法、类型与 32 场景严格检查通过。详见[流程定义版验收](../docs/GRAPH_READING_PREVIEW.md#流程定义版验收)；独立审查发现的额外绕线边界已修复并重新完整运行，不把首轮通过结果充作最终验收。
