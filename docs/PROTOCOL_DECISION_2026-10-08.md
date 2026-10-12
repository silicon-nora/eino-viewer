# Eino Viewer 协议决策草案

> 历史草案：下文保留早期兼容方向与实现审计。用户随后认可不受旧格式约束的规范化运行协议；当前设计方向及 cloud-focus / suggest-platform 的业务约束以 [新运行协议的业务落地分析](./PROTOCOL_BUSINESS_ANALYSIS_2026-10-08.md) 为准。下文“建议决定”不再是当前建议。

日期：2026-10-08。状态：基于本地三个仓库的实现审计与输入验证提出的协议基线；尚未修改采集端、Viewer 或 suggest-platform 的生产代码。

本轮已确认的取舍：**Viewer 功能完整优先，可以集中升级采集端；保留有价值的兼容能力，避免没有功能收益的大规模改名或重构。**

## 1. 建议决定

1. 新采集统一交付一个 `EinoRunRecord`，沿用当前 `schemaVersion: 1` 的外壳和分领域 Evidence Envelope；补齐生产规范及校验，而不是另造一套相同信息的 JSON。
2. `WorkflowSnapshot v1` 继续作为 Workflow 的结构与节点结果摘要，也继续接受裸快照导入。它不承担循环 Graph、重复调用和完整运行记录的职责。
3. 新记录按完整功能要求采集；旧记录按实际已有信息展示。旧记录缺失的正文、调用次数和结束事实不能通过迁移补造。
4. ViewerDocument、ExecutionDAG、Trajectory、Explanation 是读取后的派生模型，不要求业务后端生产，也不把渲染器的状态或布局约定当成运行事实。
5. 本轮目标仍是已保存记录的静态查看，覆盖 Agent、Graph、Workflow；不把流式增量传输、恢复执行、跨运行比较纳入本次协议冻结范围。应用使用流式执行后保存的最终实体可以静态查看，处理规则见下文。

## 2. 当前到底是否兼容

suggest-platform 的前端固定依赖 `eino-workflow-dag@1.3.1`。当前 Viewer 安装的依赖也是 1.3.1；Viewer 的 `adaptWorkflowSnapshot` 直接调用上游校验器，并把原快照作为 `workflow.snapshot@1.payload` 保留。

平台实际链路是：DB 的 `dag_metrics` → API 的 `step_timings` → 前端解开 JSON 字符串（若有）→ `parseWorkflowSnapshot` → `createWorkflowDAG`。节点详情、任务状态、任务结果等还有独立字段，不能认为全在 Snapshot 里。

| 对象或能力 | 实际结论 | 协议决策 |
| --- | --- | --- |
| 标准 Snapshot v1 的节点、边、分支、嵌套、path、metrics | 已有直接兼容入口；没有改名转换 | 保留 |
| 平台完整 TaskDetailResponse | 是平台 API 外壳，不能直接传入 Viewer | 平台适配层负责抽取或映射 |
| `StepTiming[]` | 平台走 PipelineView，不属于 Snapshot 协议；Viewer 不直接接收 | 保留旧展示或做独立兼容适配，不虚构拓扑 |
| `node_diagnostics` | 平台自有业务诊断，独立于 Snapshot | 保留业务扩展，按真实来源分类 |
| 整次运行输入、最终输出、结束结果 | Snapshot 本身没有完整表达 | 新采集补齐 |
| 重复访问、循环、重试、并发同名调用 | Snapshot 每条 path 最多一条最终记录 | 用逐次调用事实和调用身份表达 |
| JSON 边界 | Viewer 比 DAG 更严格，不能声称所有合法旧输入都无条件通过 | 明确数字及资源边界，采集端负责正确编码 |

另有既有数据源差异：本地 cloud-suggest 仍存在旧 `{version, scene, nodes, edges, critical_path}` DAGMetrics，而当前平台前端不把这类对象认作标准 Snapshot。这是既有链路差异，不是本次 Viewer 新增的不兼容。未连接线上数据库，不能推断各类历史格式的实际占比。

## 3. 根据功能确定必须记录的事实

“必须”指新采集端的完整记录规范；基础读取器仍接受缺少这些事实的旧记录。缺失时标记未知、未采集或部分采集，不用猜测补齐。

| Viewer 功能 | 新采集必须表达的事实 | 沿用的位置 / 所需工作 |
| --- | --- | --- |
| 一次运行的概览 | runId、来源类型、开始/结束事实、最终 outcome、采集是否有损 | RunRecord + `run.lifecycle`；将 lifecycle 纳入正式对外规范 |
| 整次输入与最终输出 | 明确根调用身份、原始值或省略原因、输出所属的结束边界 | 复用根 `component.io`；Agent 当前有独立根消息关联规则，需统一规定根归属，不把最后一条消息一概当最终输出 |
| Workflow 流程与嵌套 | 定义节点、control/data、mappings、branches、完整数组路径 | `workflow.snapshot@1`，保留现有结构 |
| Graph 定义及回环 | 可含环的定义，和实际逐次调用分开 | `compose.graph@1`；不能塞进只允许 DAG 的 Snapshot |
| 每一步的输入、输出、错误、耗时 | 同一次调用的边界、I/O、错误及原始时间语义 | `callback.event` + `component.io`；Agent 保留 `agent.event`/`schema.*` 原始事实 |
| 重复节点、多轮工具调用、嵌套同名 Agent | 每次调用独立身份、父调用身份、完整原始地址、toolCallId（若源有） | 正式规定 correlation 身份字段；不能只靠名称、path 或数组相邻关系 |
| 并行和分支 | 声明的依赖与已观察的执行关系各自有来源 | 不把观测先后顺序当依赖；没有路由证据时不宣称“已选中此边” |
| 业务详情 | 数据归属、原始内容、属于诊断还是运行 I/O | 应用命名空间下的 metadata；不能挤入通用诊断错误列表 |
| 用量与现有费用功能 | 调用级 model 标识、token_usage、叶子/汇总口径 | 保留现有 metrics.token_usage；逐次采集后同步平台计费适配，避免父子或 snapshot/evidence 重复计数 |
| 导出和回看 | 原始证据、稳定身份、可定位的采集损失 | 原记录可保存，投影不反写原记录 |

## 4. 外层和领域协议基线

外层沿用当前结构：

```ts
interface EinoRunRecord {
  schemaVersion: 1;
  runId: string;
  source: "agent" | "graph" | "workflow";
  evidence: EinoEnvelope[];
  diagnostics?: RecorderDiagnostic[];
  metadata?: Record<string, JsonValue>;
}

interface EinoEnvelope {
  protocol: "eino-dag";
  protocolVersion: 1;
  kind: string;
  kindVersion: number;
  payload: JsonValue;
  source?: Record<string, string>;       // 出现时须有 module、format
  correlation?: Record<string, string>; // RunRecord 内每条必须有相同 runId
  observedAtMs?: number;
  metadata?: Record<string, JsonValue> | null;
}
```

保留 `protocol: "eino-dag"` 是延续现有 wire 标识，不表示所有定义都必须无环。为产品改名而改这个值没有功能收益。

`evidence` 按采集顺序保存。Callback 自带的 sequence 是相应采集器的顺序，不默认等同于跨采集器的全局因果顺序。新记录需要的事实可以分布在多个现有 kind，不要求每种来源都构造全部 kind。

建议给新生产规范一个受控标识，放在现有扩展槽位中：

```json
{
  "metadata": {
    "einoViewer": {
      "profile": "run-evidence",
      "profileVersion": 1,
      "rootInvocationId": "run-42:root"
    }
  }
}
```

以上是 **RunRecord.metadata 的拟新增约定，当前没有相应校验/消费实现**。它标识所遵循的生产规范，不承诺 capture 必然 complete。新完整性检查按该版本验证身份、生命周期和支持范围内的 I/O；无此标识的旧记录按旧规则读取。纯定义记录不宣称遵循一次实际运行的采集规范。应用业务扩展使用其他命名空间。

### 必须正式规定的语义

- **运行身份：** 每条 evidence 的 `correlation.runId` 与外层一致；单个文件表达一次运行。业务 taskId 与 runId 的关系由接入方显式确定，不能默认一个任务永远只有一次运行。
- **定义身份与调用身份：** nodePath/path 是定义位置；invocationId 是一次调用。新采集端为每次实际调用提供稳定且运行内唯一的 invocationId，并将该调用的运行证据关联到它。Agent 调用、模型回合、工具调用各有独立 ID；模型回合/工具调用关联所在 Agent 父调用。callback.event/component.io 绑定产生它们的调用；agent.event/schema.message 绑定其直接生产调用，来源无法确认时保留归属未知，不能绑定最近一个同名调用。这要求升级当前 Agent 读取逻辑，单独添加 correlation 字段不会自动生效。
- **父子身份：** 建议统一 `correlation.parentInvocationId` 指向同一运行中已标识的父调用。该键可进入现有开放字符串 correlation，但当前读取逻辑尚未统一消费它，必须和 Recorder、Viewer 一起落地；原有 entityId/parentEntityId、address、runPath 保留来源含义。
- **事件关联：** callback 与对应的 component.io 继续共享 eventId；一次调用的开始/结束使用不同事件 ID、同一 invocationId。不能要求一个 eventId 在所有 evidence 间唯一，因为同一观测已有配对证据。
- **根调用：** 根 I/O 必须能证明属于本次根调用，并匹配 profile 的 rootInvocationId。metadata.io.scope 仅是声明，不能覆盖矛盾的地址或调用身份。Agent 的原始 runPath 保留；名称路径不是调用 ID。
- **Agent 根 I/O 提案：** 统一复用 component.io，component 为 `Agent`、metadata.io.scope 为 `root`、correlation.invocationId 为根调用 ID；format 明确 body 的实际类型（如 schema.Message 或应用自有 JSON），address 保留真实地址。记录本次根输入和最终交付值，不把迭代器、全部中间事件或子 Agent 的最后回复当根返回值。失败/取消没有输出是合法情况，根错误和结束结果说明原因，并不自动表示采集丢失。当前解释器只原生识别 Graph/Workflow 的根 component.io，Agent 依靠根事件、匹配消息和成功 ended 的组合规则；本提案需要同步扩展 Recorder 与解释器。
- **完成与采集质量：** `run.lifecycle` ended 的 `outcome = success | failed | cancelled | unknown`，`capture = complete | partial`。执行成功且部分脱敏/省略是合法组合；complete 只说明约定的采集范围内无已知损失，不表示所有内部状态均被记录。
- **生命周期顺序：** 每次运行至多一个 started 和一个 ended；新完整记录包含两者。历史/部分记录允许只有 ended。ended 位于运行事实之后，不再追加本次执行事件。
- **I/O 值：** `null`、空字符串、空对象均为实际值；未采集、省略、脱敏须另有标记。保持 `component.io` 当前 body/capture 规则，禁止把一个缺失 body 改成 null 来通过校验。
- **状态：** 缺记录不等于 skipped；调用失败不直接推出运行失败；业务降级不能强行改成 success 或 failed。旧 Snapshot 的三态保持原义，不加入 running/cancelled，也不把内部绘图适配的占位值导出为事实。
- **计时：** 实测耗时、起止时刻、观测跨度、推算时间不可混称。新时间戳使用 Unix 毫秒，不能把旧拓扑推算时间当实测 Unix 时间；整次耗时不靠步骤时长相加。
- **流式执行后的静态记录：** live stream 仍不进入 JSON。应用负责按自身执行逻辑消费/聚合；聚合出的最终实体另存为非流式 component.io 或 schema 证据，并保留实际调用身份与来源。未捕获正文时保留 streaming/omitted 事实及原因；完整性检查报告正文能力缺失，不把已有 metadata-only 记录宣称为完整正文，也不由 Recorder 额外抢读业务流。
- **扩展与校验：** 已知 envelope/payload 按各自版本校验；通用 diagnostics 仅放采集/协议诊断（severity/code/path/message），业务对象放应用 metadata。缺可选事实与非法结构分别处理。

上述是生产规范及已有字段的正式语义，不收紧旧 v1 数据的基础读取门槛。若需要改变旧字段含义或闭合 payload 的结构，升级对应 kindVersion；不能仅因外层仍是 v1 就宣称旧 Reader 会理解新增事实。

### 实际依赖关系的可选扩展

父子调用表示包含关系，不能替代“由哪次调用触发哪次调用”。如果产品要把某条控制/数据边明确标记为本次实际经过，建议新增 `execution.relation@1`：payload 必填 `fromInvocationId`、`toInvocationId`、`relation: control | data`；可选 `definitionEdge: { graphPath: string[], from: string, to: string }` 指回同一层定义关系。分支的明确选择也以来源调用到目标调用的 control 关系表达；仅选择分支但目标尚未调用的情形不伪造目标 invocation。

该 kind 是提案，当前尚未实现。记录来自采集端可证明的路由/数据传递，不能由 Viewer 根据时间顺序补造。引用的两次调用必须存在于同一 run；定义关系与实际关系须一致，未引用定义时不因此虚构定义边。没有这种证据时仍可展示定义拓扑和实际调用，实际依赖标记为未知，不影响旧记录可读。通用派生 tool-call/transfer 关系继续来自对应领域的明确源标识，不借此扩展改写它们。

## 5. suggest-platform 的迁移范围

建议平台 API 增加明确的 `run_record` 字段；过渡期保留 `step_timings` 供旧调用方读取。新 Viewer 优先读取 RunRecord，历史数据再经过按格式区分的兼容入口。这个 API 字段是迁移建议，当前尚不存在。

| 平台当前数据 | 迁移规则 |
| --- | --- |
| 标准 `step_timings` Snapshot | 原样作为 `workflow.snapshot` evidence；不重写 topology/path/metrics |
| task_id | 作为业务关联标识；仅在确认“一任务一次运行”时可直接成为 runId |
| task_status、err_msg | 按生产端已确认语义映射 run lifecycle / 根错误；不能由节点全部成功代替 |
| cost_ms | 保留测量来源；不要随意反推 startedAt/finishedAt |
| node_diagnostics | 放业务扩展并声明归属；旧 path.join('/') / nodeId 回退只留在兼容适配层，新身份使用数组路径和 invocationId |
| llm_input | 部分 cloud-focus 实现是脱敏后的 user prompt，不含 system prompt；只能按此事实展示，不能标为完整请求 |
| llm_output、解析后 items、scores 等 | 原始回复与业务派生结果分开保留，不能把所有诊断一律标为 output |
| result_items | 确认是否为本次根返回值；若只是业务落库投影，保留为业务结果而非伪装为完整根输出 |
| metrics.token_usage + model_name | 保留平台当前计费接口所需信息；混合模型和重复调用升级为逐次用量，旧父子去重口径保持可追溯 |

大部分拓扑生产代码可以保留；主要工作在采集的调用身份、正文与生命周期，以及平台读取/详情/计费适配。**这是一轮有实质采集工作的升级，不能只描述为换一个 JSON 外壳。** 历史数据无需为新增功能全量重写。

UI 接入也需要适配：平台现在依赖旧组件的 NodePath 点击回调、setActiveNodePath、展开/收起与方向控制。Viewer 的公共回调/控制接口不完全相同；JSON 兼容不代表可直接更换 import 而不调整宿主组件。

## 6. 本轮实际验证

执行了本地数据验证与 Viewer 投影/结果模型构建，没有修改源样本，也没有运行线上服务或浏览器全量回归。

| 输入 | 结果 |
| --- | --- |
| 平台 makeDAGSnapshot | 旧 validator 与 Viewer 均通过；payload 保留；整次结果 unknown，I/O not-observed |
| 平台 makeDAGSnapshotWithTokenUsage | 同上，原 token_usage 随快照保留；不等于费用 UI 已迁移 |
| 上述快照只包一层 RunRecord | 可读，但没有新增任何输入输出或完成事实 |
| 上述 RunRecord 加明确 ended(success, partial) | Viewer 正确认定运行成功、部分采集；I/O 仍为 not-observed |
| Viewer 真实 Recorder 样例 workflow-io-success.json | 运行成功，根与步骤输入输出 available |
| DAG 仓库的普通、kind、host 三份标准快照 | 旧 validator、adapter、Viewer 全通过 |
| 平台完整 TaskDetailResponse / StepTiming[] | 不是 Viewer 原生输入，直接传入失败 |
| metadata 含 9007199254740992 的旧快照 | DAG 校验通过，Viewer 因 unsafe_integer 拒绝 |

## 7. 协议冻结前的具体工作

1. 补齐统一规范：RunRecord、run.lifecycle、身份关联、根 I/O、采集损失、领域版本，以及当前 64 MiB / 深度 128 / 100 万值 / 数字精度边界。大 ID 应由源端按标识符编码为字符串；高精度数值不能由 Viewer 静默改型或取舍精度。
2. 补强完整记录校验：当前 `validateEinoRunRecord` 主要验证外壳与 lifecycle，不能代替各领域 payload 和跨事件身份校验。另设完整采集规范检查，保持旧记录仍可读取。
3. 落实 profile 标识、根 I/O 和新调用身份规范在三类 Recorder 与 Viewer 中的配对；验证同名并发、父调用重复、多轮工具、错误恢复等情况，避免来源名称成为身份。实际边高亮若要承诺源事实，再实施上述可选关系 kind，不能只改文档就宣称已有能力。
4. 用平台标准快照和匿名化真实完整记录建立兼容与功能验收。覆盖嵌套/分支、逐次 I/O、整体与局部失败、采集损失、重复调用/用量去重，并区分“可打开”和“功能完整”。
5. 保持旧 Snapshot 语义。当前 `executionDAGToWorkflowSnapshot` 的 running→skipped 是内部有损绘图投影，不能作为新协议状态规则；替换平台阅读入口时需要检查此路径是否仍被使用。

这些是实施与验收项，不是本轮已完成的改造。已有文档 `EINO_DAG_PROTOCOL.md` 尚缺 RunRecord/lifecycle 等内容，并含失效的 CONTRACT 相对链接，不能单独当作完整冻结规范。

## 8. 代码依据

- 平台 [依赖](../../suggest/suggest-platform/web/admin-web/package.json)、[数据入口及诊断关联](../../suggest/suggest-platform/web/admin-web/src/trace/components/TaskDetail.vue)、[绘图接入](../../suggest/suggest-platform/web/admin-web/src/trace/components/FocusDAGView.vue)、[用量与费用](../../suggest/suggest-platform/web/admin-web/src/trace/utils/modelPricing.ts)、[本轮使用的样例](../../suggest/suggest-platform/web/admin-web/test/mocks/recommend.ts)。
- 上游 [Snapshot 契约](../../eino-workflow-dag/CONTRACT.md)、[兼容规则](../../eino-workflow-dag/COMPATIBILITY.md)。
- Viewer [无损适配](../src/protocol-core.js)、[RunRecord](../src/run-record.js)、[lifecycle](../src/run-lifecycle.js)、[I/O](../src/component-protocol.js)、[输入边界](../src/record-input.js)、[结果解释](../src/explanation.js)、[调用归属](../src/execution-scopes.js)。
- 现有采集能力与限制见 [32 场景验收](./STATIC_RESULT_ITERATION_9.md)；该历史验收不是本轮重跑结果。
