# 真实 Recorder 场景扩展与静态展示评估

后续更新：本页保留首次扩展的发现与当时验收记录。上述发现的 4 个状态/归属缺陷
现已修复，严格门禁通过；新 Graph I/O 已在迭代 2 补齐，历史文件仍保留未采集限制。
当前矩阵已扩展到 32 场景，最新结果见 [迭代 9 验收](./STATIC_RESULT_ITERATION_9.md)；
初期修复见 [P0 静态结果验收](./STATIC_RESULT_P0_ACCEPTANCE.md)。自动生成的 `.artifacts` 报告
反映最新代码，不再是本页首次评估时的快照。

日期：2026-09-22。范围：新增真实本地运行测试及静态评估，不实施新的界面或投影功能。

## 结论

新增 10 个真实 Eino 场景，覆盖三类来源：9 个实际运行，1 个只编译不执行。
它们的录制、传输及整体终态可以正确识别；**静态展示真实性尚未全部通过**：
评估发现 4 个状态/归属错误，以及 Graph 节点 I/O 未采集的能力缺口。

这是扩展测试得到的新结论，不应把“文件可导入”或“测试套件退出成功”解释为所有
步骤都已展示正确。下一轮优先目标见 [静态结果路线图](./STATIC_RESULT_ROADMAP.md)。

## “真实”指什么

Agent 使用真实 `adk.Runner`、`ChatModelAgent`、工具调度、官方工具中间件接口、原生取消
和工具中断机制；恢复逻辑由测试实现，只用确定性模型替换外部服务。Graph/Workflow
使用真实 compile/Invoke；definition-only 场景只编译。
没有手工注入 callbacks 或拼装结束事件，没有网络模型请求或付费服务调用。

Golden 文件保留 Recorder 的 payload、correlation 和事件顺序。比较副本会忽略观测
时间及规范化 Eino 随机 ID/内部 checkpoint；这不表示承诺回调的全局固定顺序。
并发到达的诊断按完整内容与重复次数比较，不要求数组顺序固定；原始文件不被排序。
Go 额外检查真实输出与 golden 的运行边界和调用内 input→output、start→end/error
顺序，并用倒序反例验证检查本身有效。
Opaque checkpoint 只验证存在且编码合法，不保证跨版本反序列化，本产品也不执行它。
没有给记录补写缺失的业务输入/最终输出。

## 场景结果

| 场景 / 原始记录 | 实际结果 | 静态表现与边界 |
| --- | --- | --- |
| [Agent 直接回答](../fixtures/recorder-matrix/agent-direct-answer.json) | success / complete；工具调用 0 次 | 输入、回答保留，无需工具才能形成可查看运行 |
| [工具错误恢复](../fixtures/recorder-matrix/agent-tool-recovered.json) | 工具真实抛错，经测试编写的工具中间件恢复；success / complete | 最终成功正确，恢复后的 JSON 仍保留原供应商错误与缓存结果；不能把它虚构成一个独立重试步骤 |
| [Agent 取消](../fixtures/recorder-matrix/agent-cancelled.json) | cancelled / complete；模型后安全点取消，工具调用 0 次 | 整体取消正确；Path 和 Trajectory 都错误地把取消归给尚未执行的工具并标成 failed |
| [工具中断](../fixtures/recorder-matrix/agent-tool-interrupted.json) | unknown / complete；实际工具请求人工批准 | 整体 incomplete 正确，但 Path 和 Trajectory 的工具仍显示 running；静态图没有清楚表达中断 |
| [内容脱敏](../fixtures/recorder-matrix/agent-redacted-tool.json) | success / partial | 文件只保留 `[REDACTED]`，没有原邮箱；当前状态标题突出“不完整”但未同时直接显示“成功” |
| [Graph 步数上限](../fixtures/recorder-matrix/graph-step-limit.json) | retry 实际执行 3 次后达到上限；failed / complete | 3 次访问独立保留、整体失败正确；节点输入/输出正文未被 Recorder 捕获 |
| [Graph 取消](../fixtures/recorder-matrix/graph-cancelled.json) | 节点执行 1 次后 context 取消；cancelled / complete | 整体取消正确，源错误保留；节点 I/O 正文缺失 |
| [Workflow 中途失败](../fixtures/recorder-matrix/workflow-failed-successor.json) | prepare 成功、fail 失败、after 零次执行；failed / complete | 源 snapshot 正确；投影却给 after=success、fail=running，实际步骤计数也包含声明节点 |
| [嵌套同名节点](../fixtures/recorder-matrix/workflow-nested-names.json) | left/shared、right/shared 都成功 | 本样例的不同路径及 I/O 证据未串台；不等于证明所有嵌套或重复调用都支持 |
| [只有定义](../fixtures/recorder-matrix/workflow-definition-only.json) | 仅编译，执行 0 次，无生命周期事件 | 作为结构打开，completion 未知、无 execution 投影，不声称完成 |

`capture=complete` 只表示 Recorder 当前支持范围内没有报告采集损失，不能据此声称
Graph I/O、模型内部状态等未支持字段都已保存。

## 可复现评估

```sh
npm run test:recorder-matrix
npm run inspect:recorder-matrix -- --strict
npm run test:browser -- --workers=3
```

- 第一个命令运行新增的真实 Go 场景、golden 与 JS 传输/基础投影断言，并生成评估。
- 第二个命令是静态语义严格门禁。本轮 **实测退出 1，门禁失败，4 个缺陷未修复**；
  不使用 skip 或“预期失败测试”把它们算成产品通过。
- 浏览器矩阵验收的是导入、整体状态和证据定位，同时保存真实界面观察。
  当前未正确展示的步骤状态由单独严格门禁报告，而不是被浏览器冒充验收通过。

评估工具同时核对 Path/Trajectory，同一源缺陷按受影响视图合并计数。另有故意删除
步骤、去掉证据、只修一个视图的副本测试，避免“错误节点消失了”被误判为修复完成。
这些副本只用于测试评估工具，不替换真实记录，也不算产品修复。

自动报告：[Markdown](../.artifacts/recorder-matrix/assessment.md) ·
[JSON](../.artifacts/recorder-matrix/assessment.json)。这些是运行命令生成的本地产物，
不随 npm 包发布；再次运行会按当前实现更新。没有发现问题不代表穷尽所有语义。

源测试：[Agent](../integrations/go/static_agent_matrix_test.go) ·
[Graph/Workflow](../integrations/go/static_graph_workflow_matrix_test.go) ·
[JS 基线](../tests/recorder-matrix.test.js) ·
[浏览器矩阵](../tests/browser/recorder-matrix.spec.js)。

## 验证记录

| 检查 | 本轮实测结果 | 说明 |
| --- | --- | --- |
| 真实 Recorder 场景 | 10 / 10 通过 | 9 次实际运行 + 1 个只编译场景；包含实际工具/节点调用次数断言 |
| JS 传输与基础投影 | 10 / 10 通过 | 原记录不变、整体完成状态、证据索引及来源；不等于步骤语义正确 |
| 严格静态语义评估 | **未通过，退出 1** | 3 个场景中的 4 个状态/归属错误；Graph I/O 缺口另列为能力限制 |
| 浏览器导入与交互 | 93 / 93 通过 | Chromium / Firefox / WebKit；原 63 项 + 新矩阵 30 项，45.6 秒 |
| 全部 JS 测试、类型与语法 | 通过 | `npm test`、`npm run typecheck`、`npm run check` |
| npm 包与安装后消费者检查 | 通过 | 55 个文件，约 97.7 KiB；仅本地打包验证，没有发布 |
| Eino v0.9.19 全部 Go 测试 | 通过 | `go test -race -count=5 ./...` 与 `go vet ./...` |
| Eino v0.9.0 新增矩阵兼容 | 10 / 10 通过 | 临时 modfile，不改主模块的依赖版本 |
| 原 eino-workflow-dag | 保持干净 | `main...origin/main`，未修改原仓库 |

本机 Go 缓存采用可写临时目录；如果默认缓存无写权限，可为上述命令设置
`GOCACHE=/private/tmp/eino-viewer-go-cache`。兼容检查使用本地已有的 Eino 依赖，
不调用外部模型。

收尾复跑发现脱敏诊断并发到达顺序会令 golden 比较偶发失败，已修正比较副本的
诊断排序，并验证删掉重复项或改变诊断内容仍失败；随后全量 race 连续 5 轮通过。
这只修复测试的稳定性，没有改变 Recorder 记录、原始 golden 或上述 4 个产品缺陷。

已人工查看的浏览器截图（本地产物）：
[Workflow 中途失败](../.artifacts/recorder-matrix/workflow-failed-successor.png)、
[工具中断](../.artifacts/recorder-matrix/agent-tool-interrupted.png)、
[内容脱敏](../.artifacts/recorder-matrix/agent-redacted-tool.png)。
Workflow 画布沿用源结构，失败节点为红色，但仍列出未执行的 after；其投影状态与
画布并不完全一致。这正是下一轮必须跨视图核对事实、不能只依靠截图或顶栏的原因。

## 后续还需要覆盖

分支未选中、相同工具跨回合重复、并行乱序、多 Agent 转交、结构化与长输出、大小
限制和更多序列化失败。真实服务调用是独立的可选集成层，不用不稳定且付费的模型
输出代替确定性的静态显示回归。性能压力输入也应与真实业务场景分开标记。
