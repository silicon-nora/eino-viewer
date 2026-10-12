# 本地版本管理

2026-09-29 起，当前目录使用独立 Git 仓库。没有配置远程仓库，也没有推送或发布。

- `main`：当前已验收基线。2026-09-30 经 Owner 确认后，从 `feat/graph-reading` 快进合入，不压缩或重写逐轮提交。
- `agent-ui-accepted`：保留在首次 Agent 基线 `74399c5`，不移动。包含三入口共享 Agent 阅读器，以及当时未调整的 Graph／Workflow。
- `feat/graph-reading`：保留 Graph／Workflow 的逐轮开发历史；本轮已验收，不再标记为待确认试版。
- `viewer-ui-accepted-2026-09-30`：本轮完整验收基线的本地标签，包括最终界面及整理后的文档。不是 npm 版本或发布标签。

## 2026-09-30 验收范围

- Agent：三入口共享平铺轨迹与详情，默认首项、整行可选、完整输入输出，不展示路径图。
- 工作台 Graph：步骤、流程、详情；重复节点合并显示但执行事实独立；定义布局与执行结果解耦，保留分支、回环、连线选择和有界平移。
- 工作台 Workflow：只有流程与详情，默认整次结果；直接选择节点，保留子范围返回，默认水平向右，仍复用上游四向布局能力。
- Graph／Workflow 的嵌入及离线界面未在本轮同步改版；原始数据、公共 API、Recorder 和上游仓库不变。不支持流式或实时。

代码验收终点为 `02f2709`。本次整理只同步文档和本地版本标记，包版本仍为 `0.1.0`，没有推送、创建 GitHub Release 或发布 npm 包。

### 验证记录

- JS、语法、类型及现有 32 场景严格检查通过；四项既有采集／归属限制保留，未重新采集 Recorder。
- 两栏改造的完整三浏览器运行：602／603 通过，1 项 Firefox 大记录压力测试超时。随后修正返回范围时的焦点并原样复验，107／107 通过，包含原超时用例。
- 最终默认向右改动：三浏览器定向回归 107／107 通过，涵盖实际节点横向位置、子范围、语言切换、缩放和原始数据关联；没有新增测试数量或放宽事实断言。
- 上述是分轮运行与复验，不声称在最终提交上重新执行了一次 603／603 全通过。开发代理走查与 Owner 验收不冒充陌生用户研究。

本地日志为 `.artifacts/workflow-two-panel-all.log`、`.artifacts/workflow-two-panel-final.log`、`.artifacts/workflow-rightward-final.log`；截图为 `.artifacts/workflow-two-panel-desktop.png` 与 `.artifacts/workflow-rightward-desktop.png`。这些文件不进入 Git，本节保留验证结论和边界。

## 后续约定

后续每轮按“基线 → 独立改动 → 验证 → 本地提交”管理。提交说明记录本轮范围与实际验证结果；用户认可后再更新主线。需要回退时先检查并保存未提交修改，不使用强制重置丢弃工作。

版本管理包含源代码、测试、真实记录样例、依赖锁文件与文档。依赖目录、构建产物、浏览器日志／截图、临时输出及本地环境配置不进入 Git；`.artifacts` 不是持久版本备份。已有敏感信息扫描未发现凭据签名，但这不替代将来分享代码前的审查。

上游 `eino-workflow-dag` 是另一个仓库，本仓库的提交、分支和标签不改变它。

## 2026-10-12 协议合同开发

- `codex_protocol-v2-contract`：从 `main` 的 `417a6b1` 开始，先用 `d3f642f` 保存 10 月 8 日的两份设计分析，再实现 RunRecord v2 合同包。
- 本轮包含 Schema、生成 Go/TS 类型、语义校验、cloud-focus 扩展与合成样例；当前 Viewer/Recorder 和三个业务/上游仓库没有进行协议迁移。
- 验证范围与结果见 [合同包验收](./PROTOCOL_V2_CONTRACT_ACCEPTANCE_2026-10-12.md)。主线与已有验收标签保持在原基线，未推送或发布。

## 2026-10-12 通用 v2 采集与阅读

- 接续合同提交 `05363dc`，仍在 `codex_protocol-v2-contract` 开发。
- 新增原生 Go Recorder 和应用采集边界、共享 v2 校验器、三入口 v2 阅读器、实际 Eino 运行样例及回归。旧构造函数和旧记录仍保留原行为，新采集需显式启用。
- 详细验证与限制见 [运行链路验收](./PROTOCOL_V2_RUNTIME_ACCEPTANCE_2026-10-12.md)。cloud-focus / suggest-platform 尚未迁移；上游 `eino-workflow-dag` 不变。主线仍为 `417a6b1`，未发布或推送。
