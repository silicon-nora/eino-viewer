# 静态结果迭代 3：耗时、安全、完整查看与长记录

用户确认的边界：**不支持流式，不支持实时；暂不处理发布。**
执行期间的业务行为不由 Viewer 驱动。回看只读取已经保存的事实，不重新调用模型或工具。

## 验收范围

- [x] 执行耗时：运行与步骤均只使用真实开始/结束事实；零耗时可显示，缺失与倒退时间不编造；并行步骤时间不能求和当总时间。
- [x] 采集安全：统一 Recorder 正文的大小、脱敏与安全序列化策略，保留旧投影 API 的兼容边界。
- [x] 复杂非流式场景：增加真实 Eino 同名/重复/并行返回场景，验证输入输出归属。
- [x] 完整查看：可嵌入结果组件包含结果、步骤、详情与证据；便携单文件可以离线打开，不需要源码或本地服务。
- [x] 长记录：步骤搜索、异常定位、分页证据目录与未归属证据入口；建立 100/1,000/10,000 条合成证据的基线。
- [x] 回归验证：Go、JS、类型、构建、浏览器，原 eino-workflow-dag 仓库保持干净。

## 不在本期范围

流式采集或聚合、实时回放、重新执行、编辑编排、云上传、发布/部署/组织归属及发布治理清理。
复杂场景按真实录制事实逐项声明，不把通过若干用例扩大为完整 ADK 支持。

## 验收结果

2026-09-22：本期约定范围已实现并通过本地验收。未发布、未部署，未修改发布流程或版本归属。

### 交付内容

1. **有来源的执行时间。** 运行摘要和步骤详情显示耗时，可展开 UTC 起止时间并定位证据。
   `explanation.run.timing` 与 `explanation.nodes[].timing` 共用边界模型；仅真实配对的边界
   产生 `durationMs`。缺失、时间倒退和配对歧义明确标记；观察到消息的时间不能冒充执行耗时。
   同时修正仅收到结束回调时 Recorder 补造开始时间、工具耗时被后续 Agent 观察时间延长的问题。
2. **Recorder 运行时安全边界统一。** Graph/Workflow 根和节点 I/O、Agent 回调、事件、
   消息与工具定义使用防御性复制、配置的脱敏器和大小限制；不调用应用对象的自定义序列化方法。
   超限或不支持的内容保留省略原因和部分采集状态，不伪造空答案；空字符串、null、false、0
   仍是有效结果。详细适用范围见 [Go Recorder 文档](../integrations/go/README.md#safe-body-capture-current-checkout)。
3. **完整嵌入式结果组件。** 新增 `createEinoRunViewer`（根入口或 `/run-viewer`），包含结果、
   耗时、步骤查找、详情、分页证据目录与按需展开的路径图。支持选择、更新和销毁；多实例隔离，
   无效更新保留当前有效结果。与工作台使用同一套解释与证据索引，不另造执行事实。
4. **可直接打开的离线单 HTML。** [eino-viewer.html](../.artifacts/portable/eino-viewer.html)
   为 743,678 字节；浏览器直接打开即可导入和导出原始 JSON，无需源码、服务或网络。
   样式、脚本和许可内容内嵌，`LICENSES.txt` 为附带许可副本而非运行依赖。
   导出保留导入原文的字节；记录中的 HTML/脚本仅作为数据。三浏览器验证无 HTTP 请求。
5. **长记录阅读。** 共用 `createRunInspectionIndex`；工作台每页 25 项，可查步骤、异常、全部
   证据和未归属证据。JSON 树按需展开、每批 50 项；超过 500 步默认先显示目录，完整图需主动
   绘制，未删减原始记录。结果仍放在目录和路径之前，画布固定高度，不随长图撑大页面。
6. **新增真实复杂调用。** `agent-parallel-same-tool` 验证同名工具按慢→快计划、快→慢完成；
   `agent-repeated-tool` 验证跨回合重复调用。使用真实 ADK Runner、回调和工具执行，模型为
   确定性替身，不调用付费模型。以源调用身份关联输入输出，不根据相邻位置猜测。

### 验证记录

| 检查 | 本地结果 | 证据 |
| --- | --- | --- |
| JS 语法、单元、类型、站点和离线构建 | 全部通过 | [SDK 日志](../.artifacts/iteration-3-sdk.log) |
| 本地打包后的 ESM/CJS 消费者 | 通过；65 文件，138.0 KiB；没有发布 | [最终包检查](../.artifacts/iteration-3-package-final.log) |
| Recorder 静态矩阵严格检查 | 22 场景通过；21 次真实运行 + 1 次仅编译定义；保留 3 项已知限制 | [矩阵结果](../.artifacts/iteration-3-matrix.log) |
| 全套浏览器检查 | Chromium / Firefox / WebKit，83 × 3 = **249 通过** | [全套日志](../.artifacts/iteration-3-browser.log) |
| 最后颜色/可读性调整后的工作台复验 | 6 × 3 = **18 通过**，与全套重叠，不另算独立覆盖 | [复验日志](../.artifacts/iteration-3-inspection-final.log) |
| Go 全量测试 | 通过 | [日志](../.artifacts/iteration-3-go-test.log) |
| Go 并发检测，重复 5 次 | 通过 | [race 日志](../.artifacts/iteration-3-go-race.log) |
| Go 静态检查 | `go vet ./...` 返回 0 | [vet 日志](../.artifacts/iteration-3-go-vet.log) |
| Eino v0.9.0 兼容模块全量测试 | 通过；默认模块为 v0.9.19 | [兼容日志](../.artifacts/iteration-3-go-compat.log) |

本机实际工具链是 Go 1.25.11、Node.js 24.16.0，macOS arm64。测试原子计数器已改为
Go 1.18 可用的 API，未提升 `go.mod` 或 CI 要求；**本机没有 Go 1.18 工具链，未声称实际
运行过该版本，也未声称远端 CI 已执行。**

首轮全套检查有 6 个新增浏览器用例失败，原因是测试读取真实工具记录时使用了错误字段，
现改为源地址中的 tool-call ID 和 `body.response`；未重写样例来迎合断言。
截图检查另修正目录顺序、画布高度和深色详情区文字对比度，随后得到上述全绿结果。

截图：[工作台](../.artifacts/iteration-3/workbench-timing-inspection.png)、
[嵌入组件](../.artifacts/static-delivery/embedded-result.png)、
[离线查看器](../.artifacts/static-delivery/portable-result.png)。

### 长记录实测基线

环境：Apple M4 / 16 GiB；上述 Node.js 与本机 Playwright 浏览器。
数据明确为**合成**，分别有 25 / 250 / 2,500 步，不计入 22 个真实 Eino 场景。
下表是单次本地观察，不是跨设备 SLA；浏览器加载计时包括测试文件导入和等待展示。

| 证据数 | JSON 大小（字节） | Node 投影 / 解释 / 索引（ms） | 工作台加载 C / F / W（ms） | 工作台选择证据 C / F / W（ms） |
| --- | ---: | --- | --- | --- |
| 100 | 47,199 | 5.74 / 2.12 / 0.29 | 62 / 89 / 83 | 60 / 57 / 49 |
| 1,000 | 485,263 | 16.70 / 6.86 / 1.27 | 265 / 341 / 308 | 111 / 117 / 69 |
| 10,000 | 4,897,502 | 136.41 / 60.11 / 8.60 | 742 / 661 / 601 | 633 / 896 / 356 |

C / F / W 分别是 Chromium / Firefox / WebKit。万条证据默认目录模式下，工作台 DOM 为
875 个元素；Chromium 可观察堆约 59.6 MiB，另两种浏览器不提供该读数，不能记为零。
Node 同规模堆增量为 98.05 MiB，包含临时分配，不等于保留内存或峰值。
嵌入组件另有独立基线：Chromium 万条更新 252 ms、201 个 DOM 元素；其函数内部计时
不同于工作台端到端计时，不应直接比较。

原始数据：[Node](../.artifacts/iteration-3/performance-node.json)、
[Chromium](../.artifacts/iteration-3/performance-chromium.json)、
[Firefox](../.artifacts/iteration-3/performance-firefox.json)、
[WebKit](../.artifacts/iteration-3/performance-webkit.json)、
[嵌入组件 Chromium](../.artifacts/static-delivery/embedded-performance-chromium.json)。
可用 `npm run benchmark:static` 和浏览器回归重新测量，不把本次毫秒数设成硬性阈值。

### 保留限制与范围确认

- 不支持流式采集、流式聚合或实时展示；只查看保存后的记录。结束事实缺失时仍按未知处理。
- 正文不会自动清除秘密；应用需配置脱敏，分享前检查原始记录。安全保证针对 Recorder 运行时
  采集；显式 `Project*` 与编译拓扑保留旧序列化行为，不在同一保证内。
- Eino `ToolInfo.ParamsOneOf` 依赖自定义序列化，当前安全采集会省略参数定义并标记部分采集。
  没有用未经审计的序列化路径换取表面完整。
- 两份旧 Graph 场景没有 I/O 正文；超限场景有两份正文被有意省略。矩阵明确保留这些限制，
  `capture=complete` 不能让历史文件凭空获得缺失业务正文。
- 检索覆盖名称、ID、状态、摘要等元数据，不是正文全文检索。超大图主动展开仍可能较慢；
  分页约束展示规模，不表示整份 JSON 不占内存。
- 本期验证同名并行、乱序返回和跨回合重复；没有扩大为完整多 Agent 转交、恢复或所有嵌套
  语义均已支持。后续扩展仍需真实 Recorder → 投影 → 浏览器逐项验收。
- `eino-workflow-dag` 最终只读检查为 `main...origin/main`，无工作区变更；未修改该仓库。
