# 静态结果迭代 5：结果阅读体验收敛

日期：2026-09-22。目标：打开保存后的 Eino 记录，先看到最终结果，再按需查看路径、
调用层级和证据。保留 Agent / Graph / Workflow 三个板块，不增加流式、实时、执行控制、
公共 API、发布或上游仓库改动。

## 交付

- 工作台压缩介绍与导入区。默认最终输出在输入前；失败、取消、中断优先展示原因。
  结果区保持宽度，详情默认收起，不再长期占用一列。
- 步骤详情及 Raw 可收起、重新打开；保留选择、范围、检索和未应用草稿。Escape 返回
  触发控件，窄屏选择步骤自动带到详情。语言切换保留原页签、开闭状态、草稿及选区；
  已展开详情中切换步骤不重置手动缩放。
- 调用目录独立于搜索折叠区；路径提供放大、缩小、适应画布。Graph 已执行路径复用
  工作台的公共兼容渲染器接入，声明型 Graph 仍保留可循环的原结构。
- 嵌入组件和离线 HTML 同样最终输出优先、详情可折叠。完整运行 ID 放入运行信息，
  起止时间按需展开。离线导入成功后收为“更换记录”，原始记录仍可原样导出。
- Agent 默认使用多城市出行真实记录；Graph 使用 `graph-io-structured`；Workflow 使用
  `workflow-io-success`。三者均有源证据支持的根输入和最终输出。旧循环 Graph 和天气
  Workflow 保留为显式兼容样例，没有改造 fixture。
- 未确认调用归属的 Agent 事件在搜索、路径、轨迹、详情和键盘描述中一致标明限制，
  不标成成功工具调用。缺失耗时明确为“未记录”，真实失败保持失败。

设计遵循 frontend-design 的阅读层级建议，沿用现有冷蓝、纸白和字体，减少常驻控件，
没有重做品牌或增加装饰动画。已实际打开浏览器检查工作台桌面与窄屏，并查看嵌入及
离线截图。

## 保真与修复边界

展示适配只操作渲染副本，不修改原记录、canonical ExecutionDAG 或公开 snapshot 投影。
26 份样例在中英展示下独立检查，节点身份、边、真实失败和源内容保持不变。
仅有定义的合法 Workflow 可以缺少 `execution.nodes`：适配后仍缺失，不补造空执行。

验收过程中实际发现并修复：窄屏旧网格规则挤压结果导致重叠、声明型 Workflow 缺失
节点列表导致异常、WebKit 点击后的焦点返回差异、详情切换的展开状态说明不同步，
以及轨迹序号的文字对比度不足。原“无效导入保留视图”测试改为检查挂载实例与数据
不变，允许详情展开时正常调整画布宽度，没有降低拒绝无效输入的要求。

## 验收

最终冻结版本的 Chromium / Firefox / WebKit 全套 **121 × 3 = 363 项通过（3.0 分钟）**，
未启用失败重试。相比迭代 4 的 288 项，增加 75 项阅读体验、状态一致性和兼容回归。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 三浏览器全套 | 363 项通过 | [最终日志](../.artifacts/iteration-5/browser-final.log) |
| 语法、单元、类型 | 通过 | [语法](../.artifacts/iteration-5/check-final.log)、[单元](../.artifacts/iteration-5/unit-final.log)、[类型](../.artifacts/iteration-5/typecheck-final.log) |
| 真实矩阵严格评估 | 26 场景，0 错误，4 项明确限制 | [日志](../.artifacts/iteration-5/matrix-strict.log) |
| Go 全量 | 通过 | [日志](../.artifacts/iteration-5/go-test.log) |
| 本地包及安装后消费者 | ESM / CJS 通过，158.6 KiB，未提升 160 KiB 上限；未发布 | [日志](../.artifacts/iteration-5/package-final.log) |
| 上游状态 | 无工作区改动 | [状态](../.artifacts/iteration-5/sibling-status.log) |

浏览器检查包含正文实际几何位置与遮挡、折叠状态、手动缩放、语言切换、Raw 草稿及
选区、调用归属、旧声明型记录、失败原因、键盘操作、对比度、导出与原文逐值比对。
保留原有 100 / 1,000 / 10,000 条合成基线，但本轮不新增跨设备性能承诺。
前期失败的日志与 trace 保留在 `.artifacts/iteration-5/`，最终验收以 `browser-final.log` 为准。

实际环境：macOS arm64、Node.js 24.16.0、Go 1.25.11。Go 使用工作区缓存；未重新
运行上游共享实例 race 复现、其他 Go 版本或远端 CI，也未修改依赖与最低版本声明。

### 视觉检查

工作台按 1280×720 / 390×844 检查，三类默认记录的最终输出正文都能在首屏开始阅读。
长正文仍按需展开，不要求整份长答案挤入首屏。已查看这些实际截图：

| 展示入口 | 桌面 | 窄屏 |
| --- | --- | --- |
| Agent 工作台 | [桌面](../.artifacts/iteration-5/workbench-agent-desktop.png) | [窄屏](../.artifacts/iteration-5/workbench-agent-narrow.png) |
| Graph 工作台 | [桌面](../.artifacts/iteration-5/workbench-graph-desktop.png) | [窄屏](../.artifacts/iteration-5/workbench-graph-narrow.png) |
| Workflow 工作台 | [桌面](../.artifacts/iteration-5/workbench-workflow-desktop.png) | [窄屏](../.artifacts/iteration-5/workbench-workflow-narrow.png) |
| 嵌入组件 | [桌面](../.artifacts/iteration-5/embedded-reading-desktop.png) | [窄屏](../.artifacts/iteration-5/embedded-reading-narrow.png) |
| 离线 HTML | [桌面](../.artifacts/iteration-5/portable-reading-desktop.png) | [窄屏](../.artifacts/iteration-5/portable-reading-narrow.png) |

另有 [失败原因优先的窄屏记录](../.artifacts/iteration-5/workbench-failure-narrow.png)。

## 保留限制

- 真实矩阵仍为 26 场景（25 次真实运行、1 次仅编译定义）；没有把界面测试当作新增
  Recorder 业务覆盖。两个旧 Graph 缺 I/O、超限正文省略、部分并行 Agent 事件缺少
  调用标识，共 4 项既有限制继续明确保留。
- 调用范围过滤步骤和证据，不裁剪完整路径图；搜索仍不是正文全文检索。大图绘制仍
  按需进行，不承诺任意规模性能。
- 0 ms 仅来自实际毫秒边界相同，不将缺失时间显示为零；未知结果不会伪装成成功。
- 共享上游 ChatModelAgent 实例的并发限制仍见迭代 4；本轮没有修改 Go Recorder 或依赖。
- `eino-workflow-dag` 工作树保持干净，HEAD `286f3d7` 与 `origin/main` 一致；当前为
  `v1.3.1-1-g286f3d7`，不宣称恰在发布标签，也没有擅自回退上游提交。

交付入口：[离线 HTML](../.artifacts/portable/eino-viewer.html)、
[中文使用说明](../README.zh-CN.md)、[后续路线](./STATIC_RESULT_ROADMAP.md)。
