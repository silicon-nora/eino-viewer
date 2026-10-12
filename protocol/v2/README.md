# RunRecord v2 合同包

2026-10-12 · 通用 Recorder 和 Viewer 已接入 v2，旧版仍可独立读取。Go 使用显式 `New*RecorderV2` 构造函数直接观察新事实；三种 Viewer 入口原生读取新记录，公开 `eino-viewer/protocol-v2` 提供相同的结构和语义校验。业务宿主 cloud-focus / suggest-platform 仍需后续接入，这不代表业务迁移完成。

本规范落实 [业务落地分析](../../docs/PROTOCOL_BUSINESS_ANALYSIS_2026-10-08.md)。优先保持功能和事实完整性，采用独立的 `schemaVersion: 2`；旧 `schemaVersion: 1 + evidence` 不按字段重命名自动升级。

## 文件与验证入口

| 文件 | 职责 |
| --- | --- |
| [run-record.schema.json](./run-record.schema.json) | JSON Schema 2020-12；核心字段、类型、必填项与封闭对象结构的权威定义 |
| [validate.js](./validate.js) / [浏览器共享实现](../../src/run-record-v2.js) | CLI 与公开 API 共用结构、引用/状态/账本及注册业务扩展校验；不修改记录，不获取外部内容 |
| [types.d.ts](./types.d.ts) / [Go types](../../integrations/go/protocolv2/types.go) | 从核心 Schema 生成的线格式类型；类型通过不能代替数据校验 |
| [cloud-focus.schema.json](./cloud-focus.schema.json) / [业务规范](./CLOUD_FOCUS.md) | 独立版本的 cloud-focus annotation、评测材料和结果合同 |
| [fixtures](./fixtures/README.md) | 根据真实代码路径制作的合成、脱敏合同样例；不是线上采集记录 |

仓库根目录运行：

```sh
npm run test:protocol-v2:all
node protocol/v2/validate.js protocol/v2/fixtures/*.json
npm run test:protocol-v2:recorders
```

单项入口为 `npm run test:protocol-v2`（JS 语义和 TS 类型）、`npm run test:protocol-v2:go`（Go 保真往返）、`npm run check:protocol-v2-types` 和 `npm run check:protocol-v2-validator`（生成漂移）。修改 Schema 后运行 `npm run generate:protocol-v2-types` 和 `npm run generate:protocol-v2-validator`。生成器要求 Node 与 Go/gofmt。浏览器运行预编译校验代码，不依赖运行时 Ajv 或 `unsafe-eval`。

Go 提供 wire types、原生 Recorder 和往返工具，尚无独立的全功能 Go 校验器。跨语言验收会把 Go 输出重新交给同一 JS 校验器，避免“各自能解析”被误认为一致。

## 最小模型

```text
RunRecord
  schemaVersion: 2
  run                    一次有明确边界的运行或纯定义文档
  definitions[]          可能执行的结构，可包含回环
  invocations[]          实际发生的每一次调用
  events[]               已观察到的事件、请求和决策
  relations[]            有证据的运行关系
  contents[]             输入、输出、消息、状态、诊断、产物
  usage[]                每次实际模型调用的计量事实
  annotations[]          带版本的业务扩展
  sourceRecords[]?       可移除的原始来源附件
```

除 sourceRecords 外，集合字段即使为空也必须提供。顶层、核心实体和已注册业务 payload 不接受未声明字段；不新增业务字段来改变核心状态机。扩展使用 `namespace.type + schemaVersion`。未知 annotation type/version 保留原值并给出 warning，已知版本违反合同是 error。未知核心 major version 拒绝读取。

## 身份、边界与状态

所有 ID 是 1–256 字符、无空白的字符串；在各自实体集合内唯一，跨类别由 `{kind,id}` 区分。定义内部 edge ID 在该容器内唯一。引用只能指向同一 RunRecord 中已存在的对象；外部 task、用户、实验版本等放在 `run.correlation/labels`，不冒充本地 ID。64 位业务 ID 使用十进制字符串。

`run.mode=execution` 必须有且只有一个显式 root invocation。root 的 kind 与 run.source 相同，run.status/timing 是 root 边界的副本，不能从最后事件或任意叶节点推断。`run.mode=definition` 无 root、invocation 和 usage，status 必须为 unknown。

cloud-focus 的引擎 Run 从 `recommend.Generate` 开始，root 为 application，其下是 Workflow 调用；参数/编译错误可没有任何图定义。宿主 task/job/delivery 引用 runId 并保留自己的结果，不能覆盖引擎成功或失败。重试创建新 runId。

`invocation.parent` 是 tagged union：root、known（明确 invocationId）、unknown（必须有原因）。unknown 不等于 root，也不能绑定最近的同名调用。定义引用可缺省，例如动态模型、工具、应用操作；definitionId 是静态位置，invocation.id 是实际一次调用。名称、path、externalCallId 均不是唯一键。定义包含关系和调用父关系各自无环，定义中的流程边允许环。

状态为 running、succeeded、failed、cancelled、interrupted、unknown。失败与业务软停止、解析错误、依赖降级分开表达。failed 没有错误详情时必须标 partial capture；succeeded 的父调用允许包含失败的子调用。终态 root 含 running/unknown 子调用时需要 partial capture 说明。interrupted 可以保留尚未结束的子调用，不承诺自动恢复。

`sealedAtMs` 只是静态文档的封存时刻；不表示执行成功，也不保证存储成功。可以封存 running/interrupted 的快照。执行时间是 UTC Unix 毫秒，durationMs 为非负毫秒，basis 明确 source/observed/monotonic/unknown。观察序号不等于因果，所有事件时间相同也合法；墙钟逆序保留并告警，不能伪造新时间纠正。业务时区、业务 now_unix（秒）和 DB 写入时间分别保存。

## 定义、事件与关系

definitions 为扁平实体，parentId 表示包含；Workflow/Graph 节点仍保留 key、path、component、semanticKind、revision。component 描述 Eino 实现，semanticKind 描述业务类别，Lambda 可以是业务 llm。

定义边区分 control、dependency、data、candidate；字段映射只出现在 data 边，sourcePath/targetPath 使用 JSON Pointer，空字符串代表整个值。无直接依赖的数据输入不能被解释为控制激活。未选分支没有 invocation，选择了也不代表已开始调用。

events.sequence 在本记录内唯一且按数组严格递增，是采集器的归并顺序；不允许据此自动创建因果关系。event owner 可以 unknown 并给出采集缺口。event type 为可扩展字符串，未注册类型的 attributes 原样保留。

| relation.type | 方向与端点 |
| --- | --- |
| caused_by | invocation/event/content → 导致它的 invocation/event/content |
| responds_to | 已发生的工具 invocation 或响应 event → tool.requested event |
| transfers_to | 原 agent invocation → 实际接手的 agent invocation；请求本身见 event |
| repairs | 修复 invocation → 被修复的 invocation |
| derived_from | 派生 content → 原 content |
| reads / writes | invocation → 被读/写的 content（状态版本也是 content） |
| follows | invocation/event → 明确先于它的 invocation/event；不得从数组位置猜测 |

关系必须有已知且可解析的端点，可附 evidenceEventId；没有证据就省略关系。不可用 unknown 端点表达猜测。relations 不重复保存调用父子关系，也不把所有定义边复制为运行关系。

## Agent 消息、工具与转交

通用消息 content 使用 `schemaRef: urn:eino:run:2#/$defs/Message`，保留 role（system/developer/user/assistant/tool）、parts 和工具请求引用。parts 支持 text 或另一 content 引用，可指向图像/音频等外部内容描述符。实际 provider 请求/响应可以另存原格式，不能丢弃工具参数或原始响应来换取统一文本。

- `tool.requested` 的 attributes 为 `{toolName, externalCallId?}`，参数由 contentRefs 引用。assistant message 的 toolRequestEventIds 指向这些事件；tool message 的 respondsToEventId 指向对应请求。
- 实际工具调用通过 responds_to 关系指回请求。请求已发出但没有 invocation 是合法事实，例如中断前尚未派发。
- externalCallId 仅在调用 scope 内有意义。同名并发 Agent 可以产生相同 externalCallId；规范化关联始终使用事件/调用 ID。
- `agent.transfer-requested` 的 attributes 为 `{destinationAgent}`。只有确实观察到目标调用时才记录 transfers_to，不能由目标名称创造调用。
- 根最终输出由 root.outputRefs 明确引用，不能默认最后一条消息是最终回答。中断上下文可存 checkpoint content，但本合同不提供恢复执行 API。

## 内容、采集完整度与用量

Content 将四件事分开：角色、来源、可用性、完整度。

- data.availability=inline：必须有 value，JSON null、空字符串、空数组和空对象都是实际值。
- reference：使用宿主解析的 opaque key、sha256 和 byteLength；不能自动请求任意 URL。Schema/校验器只验证描述符，不验证尚未取得的正文和摘要值。
- missing：有明确 reason，completeness 必须 unknown。不可把缺失填成 null 或空字符串。
- provenance 为 observed/projected/reconstructed/imported；completeness 为 complete/partial/unknown；transforms 独立记录 redacted/truncated。脱敏可以是完整的脱敏投影，truncated 必须 partial。流失败后的已收到文本可为 partial，无须丢弃。

inline 的已注册 schemaRef 会校验实际内容；未知 schemaRef 原样保留并告警。关键状态在消费时固化内容版本，relations 指向具体版本。不得在运行结束后序列化已变更的共享指针，不采集凭据。业务诊断重建的 llm_input 不冒充完整真实模型输入。

run.capture.coverage 声明采集域（definitions/invocations/events/io/model/state/business）；state=complete 仅表示这些域的合同观测没有未解释的缺口，不承诺任意 Go heap 或所有外部系统已被记录。内容可以按明确策略脱敏或省略，其描述符必须如实表达。未知归属/父身份要求 state=partial；partial 至少有一项 issue，complete 不得带 issue。采集损失与 execution outcome 独立。

usage 只归属于 kind=model 的实际 invocation，一次调用最多一项；流中的多次用量观察合并到该项。provider/model 必须来自生效配置，未知省略，不以任务默认模型猜测。所有 tokens 为非负安全整数：

```text
total = input + output
inputCached ⊆ input
outputReasoning ⊆ output
```

缓存和推理细分不再加到 total。partial 用量也须满足已知下界：total 不得小于已知 input/output 或其缓存/推理子集之和；校验不填充未知维度。complete 需要 input/output/total 与已知计量 source；partial 可只记录已知维度；unknown 必须为空 tokens。零是观测到的零，未知不是零。失败调用仍可产生 usage；没有真正模型调用的修复节点不产生 usage。若声明完整 model coverage，每个模型 invocation 都有一项 usage，无法取得计量则显式 unknown。图父级合计由消费端派生，不写成另一笔账本。单价、币种、价格版本和费用估算留宿主。

input/output 引用不要求内容唯一归属于调用：共享状态、复用结果可以有多个读者，但生产 owner 与读写关系要明确。sourceRecords 仅作附件；任何核心 Ref 都不能指向它，删除附件不影响规范化语义。

## 验证边界与后续实施

结构和语义两层校验都通过才符合本合同。validator 不证明 producer 所述事实真实发生，不验证未加载的外部内容，不替代授权、存储可靠性、线上联调或计价规则。沿用现有 JSON 输入保护：64 MiB、128 层、最多 1,000,000 个值，拒绝非 JSON 对象、非有限数和不安全整数；超限内容需要拆分并保留引用与缺失说明。这些是本仓库读取器限制，不是数据库容量承诺。

存储采用 runId 幂等封存，任务与 run 分离；运行结果、内容保存和宿主交付各有边界。重试或 producer 丢失的事实不能从现有 v1 记录补造。旧数据如需读取，在独立入口适配并保留缺失语义。

目前先完成通用 Eino 采集 → RunRecord v2 → Viewer 的闭环。运行 `npm run test:protocol-v2:recorders` 会重新执行真实 Eino mock 场景，再将实时生成的 JSON 交给完整校验器和 Viewer 投影；它不依赖已提交样例冒充当前采集结果。

下一阶段以 cloud-focus 的 Generate → Eino/LLMClient/State 采集 → RunRecord → 保存/API → 读回为业务链路，然后迁移平台的详情、计费、评测、点击关联。通用回调不能观察 Lambda 内部的自定义 LLMClient 与业务状态，需要就地扩展采集，不能因为 Viewer 能打开 v2 就宣称业务事实已采齐。
