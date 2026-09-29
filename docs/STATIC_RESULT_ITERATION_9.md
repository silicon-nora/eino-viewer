# 迭代 9：复杂 Graph / Workflow 的真实静态结果验收

日期：2026-09-23。范围仍是执行完成后的非流式静态查看，不增加实时、执行器或发布。

## 交付

真实业务矩阵从 28 份扩展为 32 份：31 次真实执行、1 份只编译定义。另有 2 份数值
边界记录，不混入业务场景计数。旧 28 份记录不变，未向历史文件补写正文或结果。

| 新记录 | 真实执行事实 | 验收重点 |
| --- | --- | --- |
| [Graph 多轮成功](../fixtures/recorder-matrix/graph-multistep-loop-success.json) | prepare → evaluate → revise → evaluate → revise → evaluate → finish；fallback 调用 0 次 | 7 次子调用各自的 I/O 和身份独立；根最终为第三轮已完成路线 |
| [Graph 第二轮失败](../fixtures/recorder-matrix/graph-multistep-loop-failed.json) | 第二次 evaluate 真实报错；finish/fallback 调用 0 次 | 前次成功不被覆盖，失败保留输入/原错误，不用中间值冒充最终输出 |
| [Workflow 并行成功](../fixtures/recorder-matrix/workflow-parallel-join-success.json) | prepare → slow / fast → join → finish；fast 先完成，真实汇聚费用为 29 | 两路值进入各自字段，显示分叉汇聚，不补 fast → slow 依赖 |
| [Workflow 并行失败](../fixtures/recorder-matrix/workflow-parallel-join-failed.json) | fast 已记录成功，slow 再报库存错误；join/finish 调用 0 次 | 成功与失败各自保留，根无最终输出，未执行节点只留在声明中 |

Graph 循环包含逐次不同的业务值和独立 invocation ID。Workflow 使用 channel 同步，
在 fast 的真实 Recorder `OnEnd` 返回后才释放 slow；不是用 sleep 猜测完成顺序。
两路分支都已启动，成功记录的两条前驱输出都先于 join 输入。失败记录另核对真实回调
顺序，确保 fast 成功后 slow 才失败。

Go 测试同时检查实际函数调用次数/返回值和 Recorder 产物。Graph 比较保留访问顺序；
Workflow 比较可忽略无关兄弟输入的到达顺序，但先独立验证 actual 与 golden 的因果
边界。四个保留同一证据集合的乱序反例必须失败，不能靠排序比较掩盖因果倒置。
测试采用固定时钟稳定 golden；样例中的 0 ms 是保存的测试边界，不是性能测量结论。

## 展示与回归保护

现有示例下拉框新增四项，中英标签齐备：

- Graph：多轮路线修订、第二轮评估失败。
- Workflow：并行费用汇总、库存查询失败。

默认样例不变，没有新增面板或注释性说明。四份文件也都验证文件导入、嵌入式组件和
离线 HTML；逐步检查可见 I/O、成功/失败、精确来源跳转、根结果复制和原始记录导出。
Workflow 额外检查实际画布的分叉/汇聚连线，不能只检查内存中的投影。

加强后的语义门禁拒绝：丢失或合并 visit、I/O 串轮、结束边界错绑、错误状态/错误文案、
跨节点正文、虚构步骤或根输出、缺失/反向/新增依赖边。期望值来自真实源记录与明确
业务计算，不以另一份展示结果代替真值；保留同名节点完整路径，不靠展示 ID 拼法配对。

这轮没有发现需要改动 Go Recorder 或 `src` 投影/解释实现的新缺陷。实际修改是新增
真实记录与测试、补强验收门禁、接入现有样例入口和更新路线；不把新增测试描述为
修复了不存在的生产故障。Graph 的声明循环与观察到的调用包含关系仍分开，不凭相邻
回调编造每次分支的控制边。

## 验收

- Go 全量：`go test -race -count=1 ./...` 通过。
- Graph 新场景：`TestGraphLoopRecorderMatrix` 在 race 下重复 20 次通过。
- Workflow 新场景及因果反例：`TestParallelWorkflowRecorderMatrix` 在 race 下重复 25 次通过。
- 语法检查、18 个 JS 单元入口、类型检查、32 份严格矩阵、站点/离线构建通过。
- `npm run test:recorder-matrix` 已包含两组新 Go 测试及新 JS 专项测试，完整命令实跑通过。
- 新增 12 项 Chromium 三入口定向检查通过；最终固定构建的三浏览器完整回归
  **564 / 564 通过**，Chromium、Firefox、WebKit 各 188 项，耗时 275.5 秒，
  无跳过、无失败、无重试转绿。见 [最终浏览器报告](../.artifacts/iteration-9/browser-final.json)。

人工打开最终构建，确认新下拉选项、并行费用结果和库存失败原因直接可读，没有新增
说明面板；Graph 第二轮失败的列表同时保留前次 evaluate 成功与本次失败，成功例显示
第三轮最终路线。新场景失败变体还在 390px 宽度下逐项核对正文、状态和来源。

初轮浏览器测试修正了测试页的依赖映射，以及原始 JSON 按需填充时缺少等待的问题；
没有放宽业务断言、改写记录或增加失败重试。

## 保留边界

- 原有四项限制不变：两份旧 Graph 没有 I/O 正文、一份超限省略、一份并行 Agent 事件
  身份不明确；新记录通过不等于修好了这些历史数据缺失。
- 新的真实场景是确定性本地 Eino 执行，不调用外部模型，也不宣称覆盖所有项目拓扑。
- 不覆盖中断后恢复、直接 Agent 转交、多运行比较、流式、实时或在线监控。
- `eino-workflow-dag` 保持干净的 `286f3d7`，未修改上游已发布仓库。

下一步优先根据真实使用反馈检查长正文和深层路径阅读成本；不为增加迭代数量继续
堆叠一级功能。匿名化真实项目记录会比继续扩展同型短样例更有价值。
