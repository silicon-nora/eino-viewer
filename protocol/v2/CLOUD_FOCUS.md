# cloud-focus 业务扩展 v1

本文件与 [cloud-focus.schema.json](./cloud-focus.schema.json) 定义 RunRecord v2 的业务合同候选，依据 [业务落地分析](../../docs/PROTOCOL_BUSINESS_ANALYSIS_2026-10-08.md)。本轮仅提供可校验合同，不代表 cloud-focus 采集端、suggest-platform 或 Viewer 已完成迁移。

## 注册与版本

Schema 使用 JSON Schema draft 2020-12，catalog ID 为 `urn:eino:cloud-focus:1`。catalog 根不是 payload 校验入口；注册器必须使用下面的具体 `$defs` 引用。

| annotation.type | schemaVersion | payload schema |
| --- | --- | --- |
| `cloud-focus.route-decision` | 1 | `urn:eino:cloud-focus:1#/$defs/route-decision` |
| `cloud-focus.soft-stop` | 1 | `urn:eino:cloud-focus:1#/$defs/soft-stop` |
| `cloud-focus.validation` | 1 | `urn:eino:cloud-focus:1#/$defs/validation` |
| `cloud-focus.dependency-warning` | 1 | `urn:eino:cloud-focus:1#/$defs/dependency-warning` |
| `cloud-focus.evaluation-context` | 1 | `urn:eino:cloud-focus:1#/$defs/evaluation-context` |
| `cloud-focus.result` | 1 | `urn:eino:cloud-focus:1#/$defs/result` |

annotation 外壳沿用核心的 `{id, owner, type, schemaVersion, payload}`。核心校验外壳、ID 与引用；注册 profile 后再严格校验已知版本的 payload。未知 type 或未知 schemaVersion 原样保留并报告未注册，不能强行套用 v1，也不能在再次导出时丢弃。已注册 payload 不允许未声明字段；新增事实可以放入独立 annotation 或升级 profile 版本。

`schemaVersion` 是扩展协议版本；`result.version` 是不可变业务产物版本；PipelineVersion、模型版本和宿主评分规则版本另有各自含义，不相互代替。

## 缺失、边界与归属

可选事实缺失表示未知或未采集，不默认 `week_report`、false、0、空字符串或空数组。唯一明确的 null 语义是 `requestedIntent: null`：已知请求没有强制意图。若是否存在强制意图未知，应省略该字段。已知没有材料应引用实际的空数组/空对象内容；未能采集应引用核心 `data.availability: missing` 的 content 或省略引用，并保留原因。

| 扩展 | owner 要求 | 必须保留的含义 |
| --- | --- | --- |
| route-decision | `event`；该 event 属于实际 selector invocation | 当时确实选择的定义目标，不表示目标已经调用 |
| soft-stop | `invocation` | 调用实际发生并软停止；origin 指首个原因的调用 |
| validation | `invocation` 或属于 invocation 的 `event` | 模型返回后的业务解析/校验事实 |
| dependency-warning | `invocation` 或属于 invocation 的 `event` | 依赖异常及其降级影响，不推导全局失败 |
| evaluation-context | `run` 或 `invocation` | 固定评测材料与固定结果的绑定 |
| result | `run` 或实际生成边界的 `invocation` | 引擎业务产物，不是宿主交付状态 |

这六类已注册事实不能使用 unknown owner。归属无法确认时，不伪造绑定；保留原始内容和采集缺失说明。运行内所有核心 ID 引用必须解析到对应实体种类，不能用节点名称、路径末段或任务 ID 替代。

## 路由与执行

`route-decision.selectedDefinitionIds` 必填，列出 selector 真实选择的扁平 definition ID。`requestedIntent` 保留原始请求（包括 legacy 别名），`effectiveIntent` 只接受本版本的 `week_report / work_guidance`；`source` 记录最终生效的来源，`reasonCode`、`fallback`、`policyVersion` 只在观测到时填写。请求参数和生效策略的完整材料可分别放入 `requestContentRef / policyContentRef`。

例如请求 `week_review`、生效 `work_guidance` 与选择 guidance 子图是三个事实。只有 producer 的当前请求解析规则可以进行这个别名映射；不能据此将全部历史 week_review 运行改写成 guidance。selector 对异常输入的 fallback 也必须在选择位置记录，不能从 Generate 最终返回的 synthetic silent 反推路由。

路由事件发生后，下游硬失败、END 为空或最终零卡片都不得修改该 decision。未选定义没有 invocation；已选但尚未开始的定义同样不能伪造 invocation。执行关系由核心 relations 表达，不能把定义边或 annotation 数组顺序当作发生过的因果。

## 软停止、解析和降级

`soft-stop.reasonCode` 保留首个业务原因，例如 `no_work_items`。每个 invocation 最多一条 soft-stop annotation。`originInvocationId` 指向首次产生原因的调用；`inherited: false` 时必须等于 owner invocation ID，`inherited: true` 时必须是另一次调用，并引用已有 origin annotation、保留同一首因。不能只根据此 annotation 修改 invocation outcome。一次已经调用的节点正常短路，与根本没有调用的分支不是同一事实。

`validation.stage` 区分 work_items 与 card；`status` 区分 passed、failed 与确实未执行校验的 not_performed。`subjectContentRef` 指向被解析的响应，`modelInvocationId` 指向真正的模型请求，`reasonCode/message/detailsContentRef` 保存解析或校验信息。模型成功返回但业务格式错误，可以同时存在模型 succeeded、usage 非零和 validation failed。

同时提供 subjectContentRef 与 modelInvocationId 时，内容必须属于该请求的 outputRefs，或经显式 derived_from 关系追溯到它。模型调用须处于 validation owner 的调用范围；父身份采集不完整时给出无法核对的说明，不能按名字绑定另一请求。

`repair.status` 记录 not_required、required、attempted、exhausted 或 unavailable。not_required 明确要求 `attemptCount: 0`，不得伪造模型调用；`attemptIndex` 从 1 开始，表示本次修复轮次，`attemptCount` 表示本次观测时已实际尝试的修复次数，未知则省略。若二者同时存在，attemptIndex 不得大于 attemptCount。每次真实修复模型请求都有独立 invocation、内容和 usage，核心 `repairs` relation 从修复模型 invocation 指向被修复的模型 invocation。协议支持 N 次；当前业务上限 1 次是生产策略，不写死在 schema。

完整 model coverage 下，attempted/exhausted 必须有 modelInvocationId 与对应 repairs 关系；attemptCount 不得超过该业务范围内观察到的独立修复请求数。annotation 直接属于模型调用时，用它的父业务调用作为计数范围。事件中的次数可以是最终次数的前缀，不要求每个中间观察都等于最终总数；部分采集缺少对应证据时明确 warning。

工作项解析错误不自动触发卡片格式修复。repair 节点本身运行但不调用模型，也不产生一条模型 usage。

`dependency-warning` 表示摘要、正文、用户画像、周期画像读写等依赖问题；`effect` 显式区分 continued、fallback、omitted 与 unknown。存在实际依赖调用时才填写 `causeInvocationId`。例如画像写入失败但继续出卡，应保留 warning，不能覆盖引擎结果。详情放 `detailsContentRef`，不会被当成业务节点的原始 I/O。

## 评测材料与结果身份

`evaluation-context.resultAnnotationId` 必须指向同一 run 中的 `cloud-focus.result@1` annotation；它固定了 resultId、version、contentRef 和 itemIds。可选 `routeDecisionEventId` 指向带有 route-decision annotation 的事件；若同时记录 intent，必须与该 decision 的 effectiveIntent 一致。缺失的 intent 保持未知，不默认选择周报评分规则。

四个主要材料字段引用核心 content ID，并使用以下 `content.schemaRef`。解引用内容须为真实 JSON 结构，不接受把对象序列化为字符串，也不从 prompt 文本或节点名称猜材料。

| payload 引用字段 | content.schemaRef | 内容 |
| --- | --- | --- |
| `workItemsContentRef` | `urn:eino:cloud-focus:1#/$defs/work-items` | 事项数组，含主/辅文件与每周行为 |
| `documentsContentRef` | `urn:eino:cloud-focus:1#/$defs/documents` | 文档数组，含文件身份、摘要、正文与权限等已采集事实 |
| `userProfileContentRef` | `urn:eino:cloud-focus:1#/$defs/user-profile` | 结构化画像对象，可为已知空对象 |
| `timeContextContentRef` | `urn:eino:cloud-focus:1#/$defs/time-context` | 业务 current_time、timezone、weekday，可补 now_unix（秒） |
| result 的 `contentRef` | `urn:eino:cloud-focus:1#/$defs/result-content` | `{items: [...]}`，每项带稳定 itemId |

材料内部保留实际业务字段的 snake_case；引用及身份字段使用核心约定的 camelCase。这不是从旧 llm_input 直接转存的许可。file_id、user_id、link_id 等标识必须是精确字符串；数量和比率保留数值。`attributes` 可无损保留额外业务字段，消费端不得删除或猜测其含义。历史 follow_up 的 user_features/themes 等其他材料可通过 `additionalContentRefs` 保留独立 schema 和来源，不塞入 workItems 或伪装成当前画像。

content 的来源和采集状态必须说明材料来自真实消费输入、状态版本，还是脱敏后重建的诊断。当前 LLMInputDiag 会移除正文，不能标成完整真实请求；系统提示词也不是其中的一部分。保留实际观测到的脱敏策略和缺失原因，不能用空正文表示正文从未存在。外部 content 尚未取得时，只能确认引用和描述符，不能宣称内容值已通过结构校验。

`result.resultId + version` 在 run 内唯一定位一个不可变引擎产物。`itemIds` 与 result content 的 items 按顺序一一对应且不得重复，稳定身份由 producer 分配，不能从 title 或数组位置推导。同一个任务重试使用新的 runId；评测 case 固定 runId、result annotation、itemId 和宿主评分规则版本，不再查询 task 最新结果替换原样本。

完整正文与 itemIds 必须完全同序；部分正文允许只保留子集，但已保留的卡片仍须维持声明的相对顺序，不能借 partial 改写排序。

`status: items` 要求非空 itemIds；`status: no_items` 要求 itemIds 为空，完整结果正文为 `{ "items": [] }`；`status: unknown` 表示结果事实未完整观测，不能推断为零卡片。content 无法保留时仍需引用带缺失说明的 content 描述符；已知 status 和 itemIds 不因此被抹掉。

**no_items 不是未执行，也不直接等于失败。** 内部 Workflow 可因无材料而 failed，Generate 随后成功返回空结果；两层 invocation outcome 与 result 的 reasonCode/causeInvocationId 分别保留。若无结果原因的原始调用已观测，causeInvocationId 应指向它。

引擎 result 不包含宿主交付、数据库/缓存写入、保存回执或曝光/点击状态。宿主保存自己的 delivery itemId → engine itemId 映射及带数据源的 run 引用，不能通过 `_`、`#` 或标题回退恢复身份。case set、评测队列、评分维度、人工标记、价格表、权限、内容读取授权和产品行为事件继续属于宿主。

## 跨实体校验与迁移验收

JSON Schema 负责字段结构；核心语义校验器还须检查 owner、引用种类、同 run 归属、唯一身份、有效关联及上面的数量/一致性要求。payload 中不存在的事实不补造。result/evaluation 的内容 schema 声明、可用 inline 内容结构和 itemIds 顺序需一起验证；`data.availability: missing / reference` 的内容只报告可验证的部分。

合同样例至少覆盖两条分支、请求别名与 fallback、路由后失败、继承软停止、无需修复、解析失败后修复、工作项解析错误、依赖失败继续、空结果、未知材料、字符串画像拒绝、多卡身份和未知扩展保留。已有业务代码与旧测试可以提供行为证据，但通过本合同样例不代表生产采集、存储或消费者迁移已经完成。
