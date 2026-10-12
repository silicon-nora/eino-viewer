# RunRecord v2 合同包验收

日期：2026-10-12。范围：协议实施的第一阶段——可校验合同、生成类型与合成样例。状态：合同包已实现并通过本地验证；是接入开发的候选基线，生产采集与消费迁移尚未实施。

## 已完成

- [核心规范](../protocol/v2/README.md) 与 JSON Schema 2020-12，采用独立 `schemaVersion: 2`。
- 运行、定义、实际调用、事件、关系、内容、模型用量、业务扩展与可选来源附件；Agent 工具请求、消息、中断与转交合同。
- [cloud-focus profile](../protocol/v2/CLOUD_FOCUS.md)：实际路由、软停止、解析修复、依赖降级、评测材料、带稳定卡片身份的结果。
- 从权威核心 Schema 生成 Go/TypeScript 类型及漂移检查；Go 保留 null/缺失、已知零/未知、可选空集合和 JSON 数值表示。
- [校验器](../protocol/v2/validate.js)：结构、引用、调用父关系、结果边界、用量去重、业务材料类型与关联、数字精度保护。未知扩展保持原值并告警。
- [11 份合成场景](../protocol/v2/fixtures/README.md)及确定性生成器：两条业务分支、软停止、工作项解析失败、卡片修复、成功空结果、依赖降级与内容缺失、编译失败、循环 Graph、并发中断 Agent、纯定义。

独立复核分别覆盖类型与 Agent/Graph、业务扩展、业务场景；发现并修复了原型名称触发异常、数字舍入、关系端点错误、解析响应归属错误、无证据修复计数、重复软停止首因、部分结果改序等问题。对应正反向断言已纳入合同测试。

## 验证结果

| 验证 | 结果与边界 |
| --- | --- |
| `npm run test:protocol-v2` | 最终 64 项 JS 合同测试通过；TS 正/反向类型用例通过 |
| `npm run check:protocol-v2-types` | Go/TS 生成文件与当前 Schema 一致 |
| `npm run test:protocol-v2:go` | Go 类型、数字/null/presence 保真与全部 fixture 往返通过 |
| `node scripts/check-protocol-v2-roundtrip.js` | 11 份记录经 JSON → Go → JSON 后事实一致，重新通过 Schema/语义校验 |
| 既有 `npm test` | 原有 JS 回归及当次新合同测试通过；随后只改合同内部校验/测试，新合同定向复验通过 |
| `npm run check` / `npm run typecheck` | 既有源码语法与类型检查通过 |
| 样例重建与文档链接 | 11 JSON + 1 内容附件重新生成字节一致；新增规范的本地链接有效 |

运行完整组合入口为 `npm run test:protocol-v2:all`。本次完整组合通过后增加了 N 次修复、流失败保留部分内容、Agent 转交的三个正向用例，最终合同定向复验为 64 项；没有改动 Go 类型或样例数据，因此未重复执行不受影响的旧回归与跨语言测试。

测试使用本地合成数据，没有调用模型、业务接口或生产数据库。当前 UI/Recorder 仍为 v1，未改变展示逻辑，因此本轮未运行浏览器回归。Schema 校验不证明采集事实真实发生，也不验证尚未解析的外部正文或存储可靠性。

## 保存与后续

开发分支为 `codex_protocol-v2-contract`。此前两份分析已由 `d3f642f` 保存为本地设计基线；主线仍停留在 `417a6b1` 的已验收 Viewer。没有推送、发布或合并主线。

下一阶段：在 cloud-focus 的公共 Generate 边界建立 run，把 Eino 回调、LLMClient 与关键 State 观测汇入该合同，完成保存/API/读回的第一条真实业务链路，再迁移 Viewer 和平台消费。实施须以真实 recorder 输出替换合成验收数据，并保留完整 v1 基线回归。

仍待后续建设：独立 Go 全功能校验器、生产采集、存储/API、v2 Viewer 读取、平台详情/计费/评测/点击关联迁移。当前 Go 子包仅提供 wire types 与保真往返工具；业务 payload 的类型约束由已注册 profile Schema 负责，不把任意 RawMessage 当作已验证数据。
