# 静态结果展示 P0：事实一致性验收

日期：2026-09-22。对应 [路线图迭代 1](./STATIC_RESULT_ROADMAP.md)。

## 结论与范围

首次真实 Recorder 矩阵发现的 4 个状态/错误归属缺陷已修复。严格门禁现为
`passed-with-limitations`：已知语义错误为零，Graph 节点 I/O 未采集仍明确保留为能力
限制。本轮没有实现 Graph I/O、统一首屏结果、复杂调用平台或实时回放。

| 场景 | 当前展示 | 原始事实 |
| --- | --- | --- |
| Workflow 中途失败 | 只展示 prepare 成功、fail 失败两步，保留错误原文 | after 无执行事实，仅留在原声明和 Raw 中 |
| Agent 取消 | 工具为“仅计划 · 未观察到执行”，取消错误独立展示 | 真实工具调用次数为 0，不计为工具执行、不挂取消错误到工具 |
| 工具中断 | Path、Trajectory 和详情均为“已中断”，可见批准原因 | 根据原中断 context 的 tool subId 精确关联，原因原样保留 |
| 结束后结果缺失 | 标记“结果未记录”，不是“运行中” | 不补造成功、跳过、输出或执行时长 |

未结束的旧记录仍兼容。错误不能仅凭“只有一个待处理工具”来归属；未知、冲突或
不完整的工具身份保留为运行级事实。同名调用、循环、并行和跨 Agent 身份的全面
支持仍由后续真实场景验证，不因这四项修复宣称全部完成。

## 展示与接入

- Agent、Graph、Workflow 三个板块保留，导入自动选择，共享详情和原始证据查看方式。
- Workflow 的标准运行图和嵌入式 Viewer 都使用实际执行节点；仅定义输入仍显示结构。
- 三类运行的节点点击返回规范执行节点，带状态和证据；不会返回渲染器的假状态。
- 节点新增 `incomplete` / `cancelled` 状态；`metadata.executionState` 区分 planned、
  interrupted、unrecorded，`interruptionReason` 保留原始原因。
- 兼容渲染器无法表达的状态不再被写成 success/skipped，而是通过明确标签展示。
- 同一节点 ID 更新后立即使用新状态标签；失败导入在提交前检查实际渲染输入。
- 沿用现有界面布局与配色；状态及原因前置，技术证据仍可展开并定位完整 Raw 信封。

## 回归与验收

- 原 10 个真实 Recorder 场景的原始 JSON 未改写。
- JS 回归包含严格门禁、输入不变、证据关联、未知/冲突工具 ID、点号后缀误匹配、
  中断先后关系、Workflow 源 outcome 优先和全部矩阵兼容快照校验。
- 三浏览器包含导入、Workflow 实际两步、取消计划隔离、中断原原因、详情与 Raw
  一致性，以及嵌入式 Viewer 同 ID 更新和 canonical 点击。
- 全量 JS、类型、语法、构建及本地 npm 包与安装后消费者检查通过。
- Go Recorder 全量 race 测试和 vet 通过；不需要外部模型服务。
- `eino-workflow-dag` 原仓库保持干净，本轮没有修改或发布它。

最终三浏览器全套 **105 / 105 通过**（52.4 秒），无跳过：原 63 项 + 矩阵导入
30 项 + P0 跨视图语义 9 项 + SDK 更新/点击 3 项。

可复现命令：

```sh
npm test
npm run inspect:recorder-matrix -- --strict
npm run typecheck
npm run check
npm run test:browser -- --workers=3
npm run test:recorder-matrix
node scripts/check-eino-viewer-release.js
```

本机 Go 缓存无默认目录写权限时，设置 `GOCACHE=/private/tmp/eino-viewer-go-cache`。

包体积实测约 102.5 KiB / 55 个文件，原 100 KiB 预算调整为 104 KiB，增加的是
两种投影中的状态与关联逻辑。未混入测试样例、工作台、源码映射或兼容依赖代码；
未删除诊断、公开入口或类型来压缩体积，API/类型/消费者门禁未放宽。没有执行发布。

## 本地验收产物

以下由测试生成，不随 npm 包发布：

- [语义评估](../.artifacts/recorder-matrix/assessment.md)
- [Workflow 两个实际步骤](../.artifacts/recorder-matrix/workflow-failed-successor.png)
- [工具中断及原始原因](../.artifacts/recorder-matrix/agent-tool-interrupted.png)
- [取消与未执行工具计划](../.artifacts/recorder-matrix/agent-cancelled.png)

下一轮只推进路线图迭代 2：分别完善三类来源的首屏结果，补充安全、受限且可脱敏的
Graph 输入输出采集，不将 `capture=complete` 解释为已经拥有未支持的业务正文。
