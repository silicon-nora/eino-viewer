# 迭代 2：静态运行结果与安全 I/O

启动日期：2026-09-22。状态：已完成验收，由持久目标自驱动推进。

## 目标与停止条件

对应 [静态结果路线图](./STATIC_RESULT_ROADMAP.md) 的迭代 2，不自动进入后续迭代。
Agent、Graph、Workflow 保留独立展示入口，共享可追溯的输入、最终结果、异常和采集
完整度。只读取完成后的记录；不执行、订阅、上传业务数据，不修改或发布原
`eino-workflow-dag` 仓库。

以下全部验收完成后才结束目标：

- [x] 首屏区分输入、整次最终结果、步骤输出和异常，结果与原始证据一致。
- [x] 执行结果与采集完整度独立呈现；旧记录、定义文件及缺失正文不冒充完整结果。
- [x] Graph 根调用与节点 I/O 有明确身份；循环每次访问不会串用正文。
- [x] 新安全采集路径在最终序列化前脱敏，有默认大小限制，空字符串和 null 不等于缺失。
- [x] 真实 Recorder 覆盖结构化、空/null、长文本、超限、脱敏及成功/失败。
- [x] JS、类型、构建、包消费者、Go race/vet、严格矩阵与三浏览器验收通过。
- [x] 记录验收命令、结果、截图、明确限制和原仓库干净状态。

## 实现约束

- 兼容已有数据协议和公开入口；新增字段不改写原始信封。
- 明确根调用结果，不把最后一个节点或中间模型回答推断成整次输出。
- 缺失、空字符串、null、脱敏、源截断和界面折叠分别表达。
- 流式 reader 不被静态 Recorder 消费；无法安全采集时说明原因并保留生命周期。
- 旧真实样例不覆盖；新能力通过新增真实样例验证。
- 原有检查不得为迁就实现而删除。包体积变化须实测并解释，不静默放宽预算。

## 工作拆分

1. 采集：安全 Graph I/O、必要的 Workflow 根 I/O、真实执行样例及 Go 测试。
2. 语义：兼容的 `explanation.run` 摘要、正文与调用身份关联、逐值单测。
3. 展示：路径上方常驻运行结果，保持现有色彩/字体体系，原始证据一键定位。
4. 验收：独立矩阵断言、三浏览器、窄屏/键盘/安全文本展示及最终报告。

目前发现的边界：旧 Workflow 与 Graph 可能只有步骤或回调信息，没有根输入和
最终正文；摘要将如实显示缺失，新采集路径另用新增样例验收，不追补历史数据。

## 实现与评审记录

- 新增 `explanation.run`：result / input / output / issues / capture，各值携带原始
  信封索引；Agent 最终回答必须有根 Agent 与结束证据，不采用中间模型/工具输出。
- Graph 回调和 I/O 校验 eventId、invocationId、地址、节点路径、组件、方向与流式
  标记；冲突身份保留为未关联记录，不终结其他调用或生成最终结果。
- Workflow 根 I/O 只服务运行摘要，不生成虚假步骤；定义文件的概览和节点详情均为
  “声明”，不显示执行成功或虚构时间。
- 新增 10 份真实记录，旧 10 份 JSON 保持不变；另有派生/故意损坏的测试副本，明确
  不计入真实业务场景覆盖。
- 独立评审发现并修复自定义 `TextMarshaler` 的原始值泄漏边界；JSON/TextMarshaler
  均不执行，不支持的值明确省略，业务结果不受影响。
- 前端沿用现有字体与配色，把根输入/最终结果前置；长值仅折叠预览，可复制完整值，
  点击证据定位原信封。空字符串/null 在首屏与步骤详情一致。

## 验收命令与产物

最终结果：三浏览器 **195 / 195 通过**（1.3 分钟，无跳过），包含本轮首屏语义
20 项 × 3 浏览器；真实矩阵 **20 / 20 接受，0 个语义错误，3 项已知采集限制**。
JS、类型、语法、构建、打包后 ESM/CJS/TypeScript/Vite 消费者全部通过。
Go 全量 race 连续 5 次通过（4.111 秒），vet 及 Eino v0.9.0 兼容检查通过。

```sh
npm test
npm run check
npm run typecheck
npm run build:site
GOCACHE=/private/tmp/eino-viewer-go-cache npm run test:recorder-matrix
npm run inspect:recorder-matrix -- --strict
npx playwright test tests/browser --workers=3
node scripts/check-eino-viewer-release.js
```

在 `integrations/go` 执行 `go test -race -count=5 ./...` 和 `go vet ./...`；本地使用
独立 GOCACHE。Eino v0.9.0 兼容检查使用临时 modfile，不修改主模块依赖。

日志：

- [JS 回归](../.artifacts/iteration-2-js.log)、[构建](../.artifacts/iteration-2-build.log)
- [真实 Recorder 矩阵](../.artifacts/iteration-2-recorder-matrix.log)、[严格评估](../.artifacts/iteration-2-assessment.log)
- [三浏览器](../.artifacts/iteration-2-browser.log)、[包消费者](../.artifacts/iteration-2-package.log)
- [Go race ×5](../.artifacts/iteration-2-go-race.log)、[Go vet](../.artifacts/iteration-2-go-vet.log)、[Eino v0.9.0 兼容](../.artifacts/iteration-2-go-compat.log)

界面验收截图：

- [Agent 最终回答](../.artifacts/iteration-2/agent-final-result.png)
- [Graph 结构化输入输出](../.artifacts/iteration-2/graph-structured-result.png)
- [Graph 成功但正文超限](../.artifacts/iteration-2/graph-omitted-result.png)
- [Workflow 最终结果](../.artifacts/iteration-2/workflow-final-result.png)

## 保留的限制与取舍

- 严格矩阵保留 3 项限制：两份旧 Graph 记录没有正文；一份新 Graph 记录按大小策略
  省略正文。这些不是假成功或状态错误，也不会用其他字段补造正文。
- 新安全采集覆盖 Graph 根/节点 I/O 和 Workflow 根 I/O；Workflow 既有节点 codec
  保持原行为。流式 reader 不消费；不宣称完成了流式最终正文采集。
- 正文默认会采集，调用方需配置私密数据脱敏；不是自动识别秘密。Graph 单独设置 IO
  策略时，错误/定义仍需配置各自策略。
- 最终包约 112.3 KiB / 55 文件；从上期 104 KiB 预算调整为 114 KiB。原计划 112 KiB
  在补齐矛盾身份检查后不足，因此按最终实测保留约 1.7 KiB 余量。增加约 10 KiB 的
  摘要与校验逻辑；没有混入样例、页面、源码映射或依赖源码，其他门禁未放宽。
- 未发布、部署或修改 `eino-workflow-dag`。复杂并行调用和子 Agent 全面支持仍属于
  后续迭代，不因当前验收通过宣称已经穷尽所有场景。
