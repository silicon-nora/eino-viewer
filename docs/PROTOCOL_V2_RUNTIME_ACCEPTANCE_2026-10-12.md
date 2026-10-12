# RunRecord v2 通用采集与阅读验收

日期：2026-10-12。接续合同基线 `05363dc`，按用户要求先验证并解决 Viewer / Recorder 仍仅支持旧协议的问题，再进入 cloud-focus 业务接入。开发分支为 `codex_protocol-v2-contract`；没有推送、发布或合并主线。

## 实现范围

- **原生采集**：Go 提供 `NewAgentRecorderV2`、`NewGraphRecorderV2`、`NewWorkflowRecorderV2`，直接观察本次执行，导出 `RunRecordV2()` / `MarshalRunRecordV2()`。重复调用、同名并行调用各自有身份；未执行的定义不变成 invocation。旧构造函数保留 v1 行为，业务需要显式启用 v2。
- **应用边界**：`NewRunRecorderV2` 提供显式 Begin/End、模型用量与业务注解，可表达 Workflow 失败而外层 Generate 回退成功。模型账本按真实调用去重，未知不归零；连续观察更新同一行，不相加、不抹除已知值，非法合并不污染原账本。
- **原生消费**：工作台、嵌入阅读器和离线 HTML 共用 v2 阅读实现，不先降成 v1。保留定义、调用、事件、关系、内容、用量及扩展；移除可选 sourceRecords 不影响核心阅读。根输出来自显式 root，未派发工具请求不会变成已执行调用或最终回答。
- **交互与边界**：Agent 平铺轨迹；Graph / Workflow 定义流程、重复调用详情、嵌套范围、回环、连线、四向布局、缩放和平移；原始内容可查看和复制。绘图预算为单范围 2,000 个节点 / 5,000 条连线，超过预算仍可分页检索所有定义和连线；500 节点以上先要求主动绘制。v1/v2 可替换，非法新记录保留已接受记录和选择。外部内容引用展示描述符，不自动获取任意 URL。
- **共享校验**：公开 `eino-viewer/protocol-v2`，CLI 与浏览器使用同一结构及语义校验。构建时预编译 Schema，运行不依赖 Ajv 或 `unsafe-eval`；生成类型与校验器均有漂移检查。ESM/CJS 类型和导出随包提供。

## 独立审查中修复的问题

1. 部分 usage 的 total 小于已知 input/output/cache/reasoning 下界仍被接受。
2. Agent 转交目标不存在时，内部 callback 成功覆盖外层 Runner 的实际失败。
3. 旧 Wrap/手工事件入口缺少 v2 边界，却能静默导出只有定义的记录；现在明确拒绝不支持的导出路径。
4. 错误脱敏为空/null 产生非法空 error；现在保留失败状态，以 partial capture 说明错误正文缺失。
5. 手工模型调用错误绑定到工作流定义；应用下真实 Workflow 的定义类型不准确。
6. 工作台示例目录访问 v1 evidence 导致 v2 Agent 入口禁用；新阅读器在 flex 宿主中宽度塌缩，步骤无法点击。
7. 大图提前布局、重复调用详情平方级开销、跨层连线遗漏及范围/语言切换状态问题；已修复并通过单元及浏览器复验。13 万定义的合法记录走预算目录，不构造巨量 SVG；3,000 次重复调用按页显示，原值全部保留。

## 验证依据

模型、工具及业务字段均为本地测试数据。21 份新样例经过真实 Eino Runner/Graph/Workflow 执行；这证明通用框架的采集路径，不代表已调用 cloud-focus、真实模型服务或生产存储。

| 检查 | 结果与边界 |
| --- | --- |
| `npm test`、`npm run check`、`npm run typecheck` | 最终源码的 JS 既有回归、23 个 v2 阅读器测试、语法与公开类型通过；旧版 32 场景保留 |
| `npm run test:protocol-v2:all` | 76 个合同/审查测试、TS 类型、Go wire types、11 份合成合同跨语言往返、类型和校验器漂移全部通过 |
| `npm run test:protocol-v2:recorders` | 每次重新产生 21 份运行记录，经完整 JS 校验和 Viewer 原生投影；逐字段保真，删除来源附件后核心调用不变 |
| Go 全量及 race | `go test ./...`、`go test -race ./...` 通过；包含实际工作流失败、应用回退成功，以及外层 Agent 失败回归 |
| 旧版浏览器回归 | 603 项全部通过，覆盖 Chromium / Firefox / WebKit；原用例未删除、跳过或降低断言 |
| 最终 v2 浏览器复验 | 冻结最后补丁后，21 个场景 × 3 引擎，63/63 通过，无重试或跳过；含三入口和真实 Go 产物 |
| 打包消费者 | `node scripts/check-eino-viewer-release.js` 通过；最终 77 个包内文件、352.4 KiB，ESM/CJS 导出、安装后类型和实际消费者通过 |

浏览器按分轮结果记录：全量 666 项运行时旧版 603 项均通过，但原生 v2 源码同时在补充修复，15 项 WebKit 源码入口读取到中间状态，不能把该轮当作稳定 v2 验收。最后冻结补丁、重新构建后单独执行全部 63 项 v2 用例，结果全部通过。后续只修改文档；不声称最终提交上单次执行 666/666 全通过。

本地最终日志为 `/tmp/eino-v2-regression-verified.log`、`/tmp/eino-v2-browser-all.log`、`/tmp/eino-v2-browser-verified.log`、`/tmp/eino-v2-complete-chain-final.log`、`/tmp/eino-v2-native-final.log` 和 `/tmp/eino-v2-release-verified.log`。浏览器截图/trace 位于 `.artifacts/playwright/`，均不进入版本管理。Agent、循环 Graph 和 Workflow 截图已人工检查。共享校验器在多入口运行不算多个独立 oracle；独立审查另用最小实际 Go 程序复现根状态、空错误、错误定义关联和 usage 下界。

## 保留的限制

- 本轮完成通用静态采集与读取。没有实时 Viewer、流传输、checkpoint 恢复、外部内容存储或持久化可靠性保证。
- Agent 自动 v2 入口为 Run/Query。采集器不消费应用所有的流；未读完/流式内容保留运行中、缺失或部分采集状态。应用自行耗尽流也不会让当前自动采集器补回流正文、最终用量或缺失终态。协议和静态 Viewer 能表达、读取 partial 内容，但应用需在既有流消费点显式采集。非流式 root 耗尽后，导出最多等待已注册 callback 副本 250ms，未完整观察到的边界明确标 partial。
- Go 尚无独立完整合同校验器。注册业务扩展和跨实体约束以同一 JS 校验器为准；类型通过不等于内容通过。
- 旧来源 API、旧格式和既有测试保留。新增 `New*RecorderV2` 不会自动升级已有部署；新 Go API 与 npm 导出仍是本地未发布实现。
- 通用内容、注解可读不等于 suggest-platform 的业务专用面板、评测、费用和点击关联完成迁移。

## cloud-focus 的下一条真实闭环

只读核对的 cloud-focus 工作树干净，本轮未修改 cloud-focus / suggest-platform / eino-workflow-dag。接入顺序与事实约束见 [业务分析](./PROTOCOL_BUSINESS_ANALYSIS_2026-10-08.md)。第一条闭环应为：

```text
recommend.Generate application root
  → 同次编译的定义、实际 Workflow 子调用
  → 自定义 LLMClient 的每次真实请求及已有流消费观察
  → 封存 RunRecord，独立保存回执
  → 按 runId 读回同一份记录，校验并在 Viewer 打开
```

关键接入点是 `internal/recommend/service.go`、`runner/suggest_weekly_report.go`、`scenes/weekly_report/workflow.go`、宿主 `internal/service/llm_client.go` 及 `internal/infra/llm/stream.go`。root 开始必须早于参数/编译校验，结束必须晚于无材料错误转空结果的业务收敛；模型失败流已收到的内容与用量从现有消费循环观察，不额外消费流，也不同时记一份手工模型和一份自动 callback 模型。

新增独立 run 存储与读取端口，不能直接把 v2 塞进旧 `dag_metrics`：该列、`/get` 回填和旧平台都按 WorkflowSnapshot 读取。按 runId 幂等，同 task 重试各有新 run；保存失败不改变生成结果，preview 返回相同记录而不落库。旧 TaskDiag 作为过渡消费者继续使用。

完整业务 profile 还需 SDK 的显式 content/schema、事件/关系及当前调用/定义引用扩展入口，包括 partial response、正文引用/完整度设置和 `run.correlation/labels` 写入；现有 Begin/End/Annotate 不能独自填全这些字段。Local State 要在消费时快照。必须按白名单投影，Wire 的 AccessToken 不采集。新 SDK 尚未发布，本地联调可以使用临时 modfile/replace；不得编造可下载版本。生产保留周期、预算与管理员读权限需要业务部署时再确定，不由 Viewer 猜测。
