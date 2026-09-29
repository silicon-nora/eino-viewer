# 测试分层与维护

测试按风险分层，不把同一份数据在三个浏览器里的重复执行当作三份独立保障。

当前用例的 P0/P1/P2 分级及全部 P3 删除台账见[优先级清单](PRIORITIES.md)。浏览器现有 254 个独立场景（P0 169、P1 75、P2 10），默认执行 600 次；每个用例在源码中都有优先级标签。首次接入轮加入了示例故障隔离 P1；本轮 Agent 轨迹调整复用现有案例，没有增加浏览器案例数量。

Agent 完整阅读入口改验轨迹，保留原始步骤、值、身份、来源、范围和导出断言；低层 `createEinoViewer` 的 Agent 画布兼容仍验证。画布缩放/键盘机制移到真实 Graph/Workflow，不因移除完整阅读器的 Agent 路径而删除。两个现有 P2 复用同一份显式 UI-only 的 105 条轨迹，验证分页无重漏、焦点、内部定位与语言切换滚动保留，不冒充新的真实 Recorder 场景。

## 日常验证

```sh
npm test
npm run check
npm run typecheck
npm run test:browser -- --workers=4
```

- **Node**：21 个测试入口，覆盖协议、值类型、投影、身份、来源、状态、阅读次序、生命周期与损坏输入。新增的轨迹阅读组专门验证轨迹记录与规范步骤之间的身份桥接，不改写既有投影；32 个真实 Recorder 场景和评估器的变异负例全部保留。
- **Chromium**：完整浏览器场景，覆盖工作台、嵌入组件与离线版的实际接线和数据展示。
- **Firefox / WebKit**：与 Chromium 共享交互、布局、原生浏览器机制和已知引擎回归；不重复穷举明确标记的数据组合。

`npm run inspect:recorder-matrix -- --strict` 另外生成可读的 32 场景评估报告。它与 Node 测试使用相同评估器，不应被计作一份独立 oracle。需要重新验证 Recorder 采集端时运行 `npm run test:recorder-matrix`；本轮未修改采集端或原始 fixtures。

### 浏览器回归防重入（M1）

统一使用 `npm run test:browser -- --workers=4`。入口先占用项目的
`.artifacts/browser-validation.lock/`，再依次构建 site、portable 和运行 Playwright。
第二个任务在任何构建前失败；`--grep`、`--project`、`--output` 等参数仍原样传给 Playwright。
默认 trace/output 写入该次任务独立的 `.artifacts/playwright/browser-<token>/`；显式报告路径由调用者自行选用，勿复用其它任务的路径。

受保护入口不借用已有的 4173 服务。若端口被占用，会报错，不会停止那个服务；请由其所有者结束服务后重试。正常完成、普通测试失败，以及 Playwright 完成自身清理并正常返回退出码的 SIGINT/SIGTERM 中断后释放锁。POSIX 平台只向本入口启动的进程组发信号，不向调用者的终端组或未登记服务发信号。

Playwright 的 webServer / 浏览器可能另建独立进程组，不能用 Playwright 自身的 PID 或进程组消失证明它们已经退出。私有 v2 锁在 Playwright 启动前将 `detachedDescendants` 标为 `pending`；只有观察到正常退出码且未使用强杀，才确认管理器走完清理路径。异常信号退出或中断升级到 SIGKILL 时标为 `uncertain` 并保留锁；入口自己被 SIGKILL 时可能留下 `pending`。这些情况不会自动释放或自动恢复，即使已登记进程组全部消失。

强制退出可能留下锁。先确认原任务结束，再运行：

```sh
npm run test:browser:recover
```

恢复命令再次核验同项目、同主机的锁、任务 PID 和已登记子进程组均已退出，并要求没有待确认的独立后代；活跃或无权探测的进程、PID 已被复用的情况均不会被当作过期。构建阶段已登记的孤儿组结束后可以恢复；Playwright 阶段遗留的 `pending` / `uncertain` 不适用自动恢复。命令不终止任何进程、不按锁龄强删、不删除测试报告。
锁缺损、旧版本缺少后代清理信息、归属不明、子进程登记途中被强制结束，或平台无法核验孤儿后代时，也会保留锁。须由任务所有者根据锁的身份核查自己的服务与浏览器后代，确认全部退出后人工处理该锁；不能仅凭“4173 有进程”就停止它，不能改标志伪装成已清理，也不能删除别人的锁或报告。恢复过程本身被强制中断可能需要同样的人工核查。

只保护这个约定入口；直接运行构建脚本或 `npx playwright test` 可以绕过保护，不承诺拦截它们。
`npm run test:browser:guard` 用临时目录、假步骤和真实独立进程组的假服务验证争用、退出码、优雅中断、强杀后保留锁、残留恢复及归属保护；不执行构建、浏览器或联网服务。

## 浏览器分工

只有下列测试使用 `@data-matrix` 标签，保留全部入口、场景、原值及来源断言，默认只在 Chromium 执行。

| 文件 | 标记场景数 | 内容 |
| --- | ---: | --- |
| `recorder-matrix.spec.js` | 32 | 全部真实记录的导入、投影、完成状态；另外 3 条专门回归仍跑三引擎 |
| `default-samples.spec.js` | 4 | 示例选择与原记录、根输入输出的对应关系 |
| `complex-graph-workflow.spec.js` | 12 | 三入口 × 四个复杂 Graph / Workflow 场景的值、来源及依赖 |
| `error-capture-reading.spec.js` | 6 | 三入口 × 两类错误来源的采集边界组合 |
| `reading-consistency.spec.js` | 6 | 独立工具返回与错误共存、正文采集标志一致性 |
| `visible-step-search.spec.js` | 6 | 可见状态、调用次数、路径、原始调用 ID 的搜索集合 |
| `static-result-summary.spec.js` | 15 | 根结果、失败、缺失、脱敏、空值等事实组合 |
| 合计 | 81 | 每项都执行，不用 `skip` 隐藏失败 |

以下仍完整跑三引擎：首屏与响应式几何、六行裁切、键盘和焦点、原文选区及未应用草稿、复制反馈、文件导入与逐字导出、离线加载、500 / 501 节点、范围切换、隐藏挂载、快速更新与销毁、多实例隔离、缩放和平移。`repeated-calls-reading` 和 `step-identity-reading` 的真实图键盘操作也保留三引擎。

特别保留曾捕获 WebKit ResizeObserver 回归的仅定义 Workflow 测试。`scope-workbench` 中 Agent 调用范围切换也继续跑三引擎，现按产品方向验证范围轨迹、不创建图和阅读状态；Graph/Workflow 的挂载与范围图回归仍保留。不能因为这些用例同时检查数据事实就降级。

新测试默认跑三引擎。只有确定属于数据组合、并能指出浏览器机制的保留测试时才加标签。若以后向已标记测试加入独有的布局、焦点或生命周期断言，应移除标签或把该机制拆成三引擎测试。

需要诊断某一记录的引擎差异时，可临时恢复所有引擎组合：

```sh
EINO_VIEWER_ALL_ENGINES=1 npm run test:browser -- --workers=4
```

这仍可配合 `--project=webkit` 或 `--grep` 定向检查。不把全组合设为日常默认，但也不声称抽样与全组合的发现能力完全相同：某份特定记录才会触发的引擎缺陷，发现概率会降低。

## 2026-09-23 清理记录

该轮默认执行清单从 **780 → 611**（减少 169 次，21.7%）：Chromium 259，Firefox 176，WebKit 176。其中 166 次是跨引擎组合去重；另 3 次来自删除 1 个在三引擎重复运行的冗余场景。当时全组合模式是 777 次；后续 P3 清理见优先级清单。

实际删除或合并的检查及其保留位置：

| 删除或合并项 | 保留保障 |
| --- | --- |
| `nested-workbench` 的窄屏键盘层级与非法导入用例 | `scope-workbench` 的 `narrow keyboard scope browsing…` 覆盖同记录、390px、两层键盘导航、焦点、非法导入后的范围与选择、原记录，还检查语言、查询与局部结果 |
| `complex-graph-workflow.test.js` 的 4 次重复整套评估 | 合并进 `recorder-matrix.test.js` 的全矩阵循环；4 个场景仍要求 findings 全空，且必须在矩阵中注册。业务常量与全部变异负例未删 |
| `renderer-presentation.test.js` 的重复 5 fixture 读取和投影循环 | “不凭名称生成调用次数”断言并入相同 fixtures 的身份循环 |
| `reading-presentation.test.js` 重复调用同一函数、同一参数的伪 scope 检查 | 真正改变节点子集的编号与身份检查仍在 `renderer-presentation.test.js`；原记录不变和双语断言保留 |

当前工作目录没有 Git 元数据，修改前的测试与配置副本保存在 `.artifacts/test-simplification/before/`，可恢复；没有删除原始记录、历史验收证据或生产文件。上一轮 780 全通过是历史结果，不改写历史报告。

本轮验收：**611 / 611 通过**（Chromium 259、Firefox 176、WebKit 176），无失败、跳过、重试或 flaky。20 个 JS 入口、语法、类型及 32 场景严格检查通过，四项既有采集限制不变。163 个生产、页面、fixture 和 Go 文件逐字校验未变，上游仓库仍干净。

同机、同为 4 workers 的单次 Playwright 测量由 409.2 秒降至 264.3 秒（约 6 分 49 秒 → 4 分 24 秒）；这是本次实测，不是性能承诺。详细执行记录在 `.artifacts/test-simplification/browser.json`，对照基线在 `.artifacts/product-refinement/browser-final.json`。
