# 静态结果迭代 4：复杂调用归属与分层阅读

日期：2026-09-22。目标：读取保存后的 Eino 记录，准确区分父子调用、局部结果、最终结果与失败责任。
本轮不做流式、实时、执行控制、中断后恢复、发布或部署；不修改原 `eino-workflow-dag` 仓库。

## 本轮交付

### 1. 四个真实 Agent-as-tool 场景

使用真实 Eino Runner、NewAgentTool、ChatModelAgent、工具执行和 Recorder；模型是确定性替身，
没有网络模型调用。没有手工补写成功、错误、结束事件来迎合展示。

| 场景 | 要验证的事实 | 最终结果 |
| --- | --- | --- |
| [父子答案不同](../fixtures/recorder-matrix/agent-nested-distinct-results.json) | 子结果不能成为根答案 | 22 条证据；父级最终汇总独立保留 |
| [同名子调用并行](../fixtures/recorder-matrix/agent-nested-parallel-scopes.json) | fast 先于 slow 完成，内层均使用 `shared-inner-call` | 34 条证据；地址区分两次调用，歧义事件不强配 |
| [子失败、父成功](../fixtures/recorder-matrix/agent-nested-failure-recovered.json) | 原始子错误不能因父级 fallback 消失 | 17 条证据；子步骤 failed，整次运行 success |
| [失败向上传播](../fixtures/recorder-matrix/agent-nested-failure-propagated.json) | 根失败不产生虚构答案 | 13 条证据；失败与局部错误分别保留 |

原有 22 份 fixture 未修改。矩阵现为 **26 场景：25 次真实运行 + 1 次仅编译定义**。
合成压力数据、删减证据和改坏投影的副本不算额外真实场景。

### 2. 归属与 Recorder 修复

- 工具调用身份使用完整源地址，包含外层调用 ID 和子 Agent 层级，不只靠工具名或内层 ID。
- 子 Agent 的回答保留为源 `agent.event`，不再派生成顶层 `schema.message`。
- 补采嵌套组件的 `callback.event` 错误，保留真实地址、时间和错误内容，并继续应用安全复制、
  脱敏与大小策略。错误详情被省略时用明确的采集提示和 metadata 标识，不冒充原始错误。
- 根最终输出只由根 Agent 的最终事件和对应派生消息证明；后到达的子事件不能取代根结果。
- 子步骤真实失败与根最终成功分开。界面显示“局部失败，整体成功”；`issue.recovered` 仍保留
  “该步骤自身恢复”的原义，不把失败的子步骤改成成功。
- 不通过根错误文本中的工具 ID 推断跨层错误归属。缺少自身结束证据的外层工具仍显示结果
  未记录，不因为根失败就补造它的失败边界或耗时。
- 名称路径无法区分并行调用时，事件明确保留为未确认归属。即使部分记录丢失了一条调用的
  全部内外层地址，父级仍保留的多个调用计划/结果也会否定虚假的“唯一匹配”。

最后一项来自独立审查中实际复现的串台：删除 fast 全部地址后，slow 曾错误吸收两个子调用
的事件。现已修复，并在 DAG、轨迹、解释三个层面加入负向回归；未修改原始样例。

### 3. 结果优先的分层阅读

工作台、嵌入组件和离线 HTML 使用共同的 `explanation.groups` 与检索索引。
组只保存明确的父级、直接成员和证据引用，不是新的执行步骤，也不推断组最终结果或组耗时。

| 板块 | 分层方式 | 不变的约束 |
| --- | --- | --- |
| Agent | 完整调用地址；父子目录及面包屑 | 同名并发独立；歧义有单独入口 |
| Graph | 已记录的图调用与访问列表 | 循环每次访问独立，不合并执行次数 |
| Workflow | 源节点路径对应的编排层级 | 声明不等于执行；同名嵌套节点不串台 |

目录可收起、按需展开并分页；范围筛选包含后代，局部步骤的输入输出明确标为局部值。
顶层最终结果始终保留。范围只筛选步骤/证据目录，**完整路径图仍表示整份记录**；没有实现
自动裁剪局部图，也没有删减原始数据。未确认归属的事件不会标成额外的工具执行。

嵌入 API 新增 `selectGroup(id)`、`selectGroup(null)` 和 `selectedGroupId`。
切换范围时清除不属于新范围的步骤与 Raw 选择；显式跨范围查看证据恢复到全部范围。
无效文件导入保留上一份有效记录、当前范围和选择。原有选择、更新、销毁契约继续验证。

设计沿用原有字体与冷蓝/纸白界面，不重做首页；把层级作为结果之后的阅读辅助。
已人工检查 [工作台](../.artifacts/iteration-4/workbench-nested.png)、
[嵌入组件](../.artifacts/iteration-4/embedded-nested.png)、
[390px 离线界面](../.artifacts/iteration-4/portable-nested-narrow.png) 的截图。

## 验收记录

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| JS 语法、单元、类型 | 通过；含跨层同 ID、非对称时间、缺地址、多运行、迟到子事件负测 | [日志](../.artifacts/iteration-4-sdk.log) |
| 26 场景严格矩阵 | 通过；4 项明确保留限制，无错误级发现 | [评估](../.artifacts/iteration-4-assessment.log) |
| Go 全量 | 通过 | [日志](../.artifacts/iteration-4-go-test.log) |
| Go race，重复 5 次 | 隔离上游实例的正常场景全部通过，限制见下节 | [日志](../.artifacts/iteration-4-go-race.log) |
| Go vet | 退出 0 | [日志](../.artifacts/iteration-4-go-vet.log) |
| Eino v0.9.0 全量兼容 | 通过；主模块仍为 v0.9.19 | [日志](../.artifacts/iteration-4-go-compat.log) |
| 新场景与安全测试重复 10 次 | 通过 | [日志](../.artifacts/iteration-4-go-nested-repeat.log) |
| 本地包和安装后 ESM/CJS 消费者 | 通过；没有发布 | [最终包检查](../.artifacts/iteration-4-package-final.log) |
| 三浏览器全套 | Chromium / Firefox / WebKit，96 × 3 = **288 项通过**（2.0 分钟） | [日志](../.artifacts/iteration-4-browser.log) |

真实运行、独立源对照、篡改投影的反例和浏览器交互分层验收。新的严格检查可以识别：
将两个作用域的工具证据合并、用子回答代替根回答、删除局部错误、将失败子步骤标为恢复。
已有 100 / 1,000 / 10,000 条合成证据浏览器基线仍在全套中回归，不宣称新增跨设备性能保证。

实际工具链为 Go 1.25.11、Node.js 24.16.0，macOS arm64。未运行 Go 1.18 工具链或远端 CI；
未提升模块最低 Go 声明。Python 环境没有 Playwright，使用项目现有 JS 浏览器套件验收。

## 上游共享实例并发限制

真实并行测试首次发现当前 Eino v0.9.19 的共享 `ChatModelAgent` 在两次 Run 中写入同一配置，
race 报告定位到上游 `adk/chatmodel.go`。这不是 Recorder 自己的锁竞争，本轮没有修改依赖。
原始 [race 日志](../.artifacts/iteration-4-upstream-shared-agent-race.log) 保留，可单独复现：

```sh
cd integrations/go
EINO_REPRO_SHARED_AGENT_RACE=1 go test -race -run TestNestedAgentRecorderMatrix/agent-nested-parallel-scopes -count=5 .
```

正常验收使用同一逻辑 worker、同一 AgentTool，但每次调用创建独立真实 ChatModelAgent。
仍然是真并行、乱序返回、重复内层 ID；没有降级成顺序执行。**测试通过不代表共享上游实例
的竞争已修复，也不承诺所有 Eino Agent 实例可安全并发复用。**

## 保留边界

- 并行子 AgentEvent 只带名字，没有调用实例 ID。完整 component 地址能证明各自 I/O，
  但不足以替每条名字事件补造身份；这些事件在目录、轨迹与 Raw 中仍可查。
- 两份历史 Graph 缺 I/O、一个超限场景有正文省略；加上上述 Agent 事件归属限制，严格矩阵
  为 passed-with-limitations，不称为全面支持所有 Eino 场景。
- 安全采集不等于自动脱敏；工具参数定义的安全省略边界仍与迭代 3 一致。
- 没有扩展真实直接转交、任意深度多 Agent 或中断后恢复的完成声明。恢复需单独定义执行
  片段、关联身份和等待时间，本轮未执行或实现恢复功能。
- 本地 SDK 因作用域与目录代码增长，包大小检查上限从 150 KiB 调整为 160 KiB；没有改版本、
  发布流程或部署目标。离线 HTML 继续单文件、无网络，原记录可原样导出。
- `eino-workflow-dag` 保持 `main...origin/main`，没有工作区变更。

交付入口：[离线查看器](../.artifacts/portable/eino-viewer.html)、[使用说明](../README.zh-CN.md)。
