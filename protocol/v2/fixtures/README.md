# RunRecord v2 合成场景

这些文件全部由 `generate-fixtures.mjs` 在本地构造，**不是线上采集，不包含真实用户、文件、凭据、模型请求或用量**。固定时间、provider/model、外部调用 ID、文档和卡片均为测试值。这里的 `provenance: observed`、`usage.source: provider` 表示合成场景模拟的采集来源，不能作为实际生产证据；每份记录的 producer 和 labels 都明确标记 synthetic。

cloud-focus 场景参考已核对的业务调用形状：应用 Generate 包含 Workflow、两条内容臂互斥、周报推荐与画像写入并行、guidance 正文与工作项识别并行。定义保留这些节点、依赖和关键字段映射，用于合同验收；不宣称是某次真实 Eino 编译结果的逐字段导出。它们验证协议表达力，不能替代未来生产 collector 的集成测试。

## 场景与预期

| 文件 | 场景 | Invocation 数 | 模型调用 / usage 条数 | 合成 total tokens | 结果卡片 |
| --- | --- | ---: | ---: | ---: | ---: |
| `cloud-focus-week-report-normal.json` | 周报正常；推荐与画像写入并行；结构化评测材料与两张稳定 ID 卡片 | 25 | 2 | 460 | 2 |
| `cloud-focus-work-guidance-normal.json` | guidance 正常；正文与工作项识别并行，到卡片准备合流 | 23 | 2 | 460 | 2 |
| `cloud-focus-soft-stop.json` | 只有只读候选，prepare 决定 no_primary_candidate；下游真实执行但不调用模型 | 21 | 0 | 0 | 0 |
| `cloud-focus-work-items-parse-soft-stop.json` | 工作项模型成功返回畸形内容；format_error → no_work_items；没有卡片修复 | 24 | 1 | 160 | 0 |
| `cloud-focus-card-repair.json` | 工作项成功；卡片模型成功但解析失败；独立修复模型调用成功 | 26 | 3 | 570 | 1 |
| `cloud-focus-workflow-failed-success-empty.json` | resolve 全过滤；节点与 Workflow failed，Generate 收敛为成功空结果；未运行 router | 4 | 0 | 0 | 0 |
| `cloud-focus-dependency-degraded-partial.json` | 用户画像依赖失败但保留身份继续生成；导出正文缺失且诊断截断 | 23 | 2 | 460 | 2 |
| `cloud-focus-compile-failure.json` | Generate root 失败；尚未有可用定义或 Workflow invocation | 1 | 0 | 0 | — |
| `graph-loop-repeated-definition.json` | 同一 transform/check 定义各执行 3 次；定义图有环，包含树无环 | 7 | 0 | 0 | — |
| `agent-parallel-interrupted.json` | 两个同名 worker 并发；同名工具重复 externalCallId；一个工具尚未结束，一个仅请求未派发 | 7 | 2 | 320 | — |
| `definition-only-workflow.json` | 只有定义，status unknown；没有 rootInvocationId、调用或 usage | 0 | 0 | 0 | — |

每份 execution 的 run status、timing、source 分别与 root invocation 的 status、timing、kind 一致。应用 root 没有被强制绑定 Eino definition。独立运行内 ID 可复用到另一份记录，不表示跨运行身份相同。

## 必须保留的语义

- 未选内容臂只有 definition，没有虚构的 skipped invocation。继承 soft-stop 的节点实际 succeeded，首因由 `cloud-focus.soft-stop.originInvocationId` 指向真正决策点。
- `cloud-focus.result` 与 `cloud-focus.evaluation-context` 使用可解析引用；多卡 itemIds 顺序与 result content 一致。修复场景保留两个识别出的工作项，而最终卡片只有一张，不能从结果数反推评测材料。
- card repair 的 3 条 usage 分别属于工作项、原卡片、修复模型。父节点无重复账本；缓存输入已包含在 input，推理输出已包含在 output，不能再次相加。现行业务装配最多修复 1 次，此样例没有伪装成已发生多次重试。
- Graph 的循环使用不同 invocation ID 和 iteration 引用同一 definition。State 版本有显式 reads/writes 关系，数组顺序不是依赖证明。
- Agent 的 assistant Message 使用 toolRequestEventIds；工具 Message 使用 respondsToEventId。相同 externalCallId 不用于去重，也不用于推断父调用。`render` 只有请求事件和工具定义，没有 invocation；右侧 lookup 有真实 running invocation。root interrupted 与部分采集同时成立。
- Agent root 的最终输出引用指向 missing content，原因是中断前没有产出最终回答，不伪造成功回答。Graph root 的最终结果则明确引用 `{ "counter": 3 }`。
- 事件 sequence 在数组中严格递增。并行请求/节点允许相同 atMs；sequence 是采集顺序，不是因果关系。
- `c:previous-result` 的 inline null 是已观测空值。missing content 为 completeness unknown；截断诊断为 partial；完整的脱敏诊断可以 completeness complete，同时保留 transforms。
- 画像依赖失败属于业务降级；正文没有随包保存属于采集缺失。它们分别存在 dependency-warning 与 capture issue，不混淆为整个生成失败。
- 所有数据都有 synthetic 来源标记。没有任何 sourceRecords，验证规范化实体不依赖原始 Eino evidence 即可读取。

## 引用内容

`cloud-focus-week-report-normal.json` 包含受控 reference content，key 为 `reference-system-prompt.txt`。该文件与样例同目录，SHA-256 与 UTF-8 byteLength 对应实际文件字节；解析器应由显式允许的 fixture resolver 加载，不能把 key 当可任意访问的路径或 URL。其余合同引用均在同份 RunRecord 内解析。校验器不联网，也不会自动取回 reference 内容。

## 重建和校验

在仓库根目录运行：

```sh
node protocol/v2/fixtures/generate-fixtures.mjs
node protocol/v2/validate.js protocol/v2/fixtures/*.json
```

生成器只改写本目录下明确列出的合成 JSON 与文本附件，不读取环境凭据、不访问网络，也不运行 Eino 或模型。生成结果确定；修改场景应修改生成器并重新生成，而非单独修改 JSON。核心 schema、业务 profile 和 validator 由合同包单独维护。
