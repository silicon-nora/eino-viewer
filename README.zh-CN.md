# eino-viewer

用于查看一次真实 Eino 运行的只读可视化库。

`eino-viewer` 展示输入、Agent 轨迹或 Graph/Workflow 路径、步骤输入输出以及最终输出或失败，不执行程序，
也不补造缺失关系。Agent、Graph、Workflow 是从记录自动识别的运行来源。

RunRecord v2 可由 Go 的 `NewAgentRecorderV2`、`NewGraphRecorderV2`、`NewWorkflowRecorderV2`
直接采集，并通过 `RunRecordV2()` / `MarshalRunRecordV2()` 输出。Viewer 的嵌入、工作台和离线入口
均可读取 v1 / v2；v2 直接保留定义、逐次调用、事件、正文、用量和业务扩展，不自动把旧记录升级成新事实。
这一步完成通用采集与阅读链路；cloud-focus / suggest-platform 的业务接入另行实施。
上述 v2 API 是本地未发布实现；原 Go 构造函数默认仍产生 v1。

新协议的独立校验入口：

```js
import { parseRunRecordV2, validateRunRecordV2 } from "eino-viewer/protocol-v2";
import { createEinoRunViewer } from "eino-viewer/run-viewer";
const record = parseRunRecordV2(jsonText); // 先检查输入精度和大小，再检查结构与跨实体语义
const result = validateRunRecordV2(record); // { ok, errors, warnings }，不修改输入
createEinoRunViewer(container, record, { locale: "zh" });
```

合同与采集边界见 [v2 规范](https://github.com/silicon-nora/eino-viewer/blob/main/protocol/v2/README.md)。

支持保存后的静态记录；v2 可保留显式观察到的流式部分正文。Viewer 不执行运行、不消费流、不订阅实时事件、不上传记录。
旧记录、未完成记录和只有定义的记录仍可查看，但不会补造结果。Go 自动采集有明确的流边界限制，接入流式应用前请查看 Recorder 说明。

## 选择入口

- **还没有记录，先体验：**打开[仓库工作台](#仓库工作台)，选择 Agent、Graph 或 Workflow 示例。
- **已有保存的记录：**[直接在本地打开](#打开已保存的记录)，无需接入应用。
- **在应用中嵌入完整阅读体验：**使用 [`createEinoRunViewer`](#嵌入完整阅读器)。
- **只需要画布，自行组织详情：**使用既有 [`createEinoViewer`](#低层画布与兼容入口)。
- **需要生成记录：**给现有 Agent、Graph 或 Workflow 接入 [Go Recorder](https://github.com/silicon-nora/eino-viewer/blob/main/integrations/go/README.md#recorder-overview)，
  再[保存已完成的运行](https://github.com/silicon-nora/eino-viewer/blob/main/integrations/go/README.md#save-and-open-a-run-record)，无需手工拼装信封。

## 打开已保存的记录

### 离线 HTML

如果已经拿到 `eino-viewer.html`，直接用浏览器打开，再选择、拖入或粘贴 Run Record JSON。
查看器会自动识别来源，展示 Agent 轨迹或 Graph/Workflow 结果与路径；选择步骤可读输入输出，Graph/Workflow 的来源链接可定位原始证据。

维护者在已安装依赖的仓库中生成离线包：

```sh
npm run build:portable
```

将 `.artifacts/portable/eino-viewer.html` 与同目录的 `LICENSES.txt` 一起交给使用者。
使用者无需源码、Node.js、Python、服务、账户或网络连接。导出保留已接受的 JSON 原文。
查看器不会自动脱敏，分享记录前请检查私密信息。

### 仓库工作台

在已安装依赖的仓库根目录执行（Node.js 20 或以上）：

```sh
npm run build:site
python3 -m http.server 4173 --bind 127.0.0.1
```

打开 `http://127.0.0.1:4173/.artifacts/pages/?lang=zh`，点击 Agent、Graph 或 Workflow
示例卡片，即可查看一次真实采集的运行。选择前不打开记录。打开后，“更换记录”只有一个下拉框，
默认选中当前记录，只列出当前类型的示例。切换类型请返回首页选择，当前语言会保留。

“接入自己的 Eino 应用”链接到 Go Recorder 接入说明，由 Recorder 生成记录，
不要求使用者手写标准 JSON。工作台不支持打开或拖入文件；已有记录请用上方的离线 HTML 打开，
或传给下方的嵌入阅读器。

无效示例保留上一份有效记录与选择。工作台不提供原始记录编辑器，现有 v1 示例没有技术目录。

下面描述现有 v1 示例的已验收界面；v2 使用后文说明的三入口共享阅读器。

- **Agent：轨迹＋详情。** 轨迹按内容完整平铺，默认选中首项；点击整行查看输入、输出，只标明异常状态。
- **Graph：步骤＋流程＋详情。** 同一节点的多次执行合并显示在流程图中，步骤及详情仍保留每次访问的原始值。
  图依据定义展示连接、条件分支与回环，结构布局不随成功或失败结果改变；节点叠加可确认的执行次数和异常次数。
  连线可选择，但不冒充实际经过的路线，未观测节点不等同于跳过。整次结果从根运行步骤查看，不另放重复结果卡。
  缺少可靠定义或子范围无法对应定义时回退为明确标识的“调用关系”；根运行不伪装为结构起点。
- **Workflow：流程＋详情。** 没有步骤侧栏或搜索，默认展示整次运行结果；直接点流程节点查看输入、输出，
  通过详情标题旁的“运行结果”返回。流程默认水平向右，复用 `eino-workflow-dag` 的四向绘制能力；子流程保留范围返回入口。

Graph／Workflow 的流程面板固定展开，缩放与适应画布位于标题栏；详情先输入后输出，输入输出正文完整展开。
本轮简化已获 Owner 验收，只应用于工作台 Graph／Workflow；它们的嵌入／离线界面未同步改版。
Agent 已在三个入口共享同一阅读核心。原始记录、公共 API 和绘图保护不变，Graph 定义超过 500 个节点也需主动绘制。

维护者可查看[本地版本管理与验收基线](https://github.com/silicon-nora/eino-viewer/blob/main/docs/LOCAL_VERSION_CONTROL.md)；保留最初的 Agent 标签和后续完整提交历史。

## 嵌入完整阅读器

在使用打包工具的应用中安装依赖：

```sh
npm install eino-viewer eino-workflow-dag
```

页面提供一个容器：

```html
<div id="viewer"></div>
```

把 Recorder 生成的 `runRecord` 对象传给完整阅读器；渲染器样式全局引入一次：

```js
import { createEinoRunViewer } from "eino-viewer";
import "eino-workflow-dag/styles.css";

const viewer = createEinoRunViewer(
  document.querySelector("#viewer"),
  runRecord,
  { locale: "zh" },
);
```

Agent 与工作台、离线版共用同一套轨迹、详情、交互和样式。Graph/Workflow 保留运行结果、真实耗时、路径、调用目录、步骤搜索、输入输出详情和分页证据目录。
也可从 `eino-viewer/run-viewer` 导入，不需要指定适配器或来源类型。

另一份记录准备好后更新原实例；宿主移除阅读器时销毁：

```js
viewer.update(nextRunRecord);
// 组件卸载时：
viewer.destroy();
```

`selectStep(id)` 选择解释后的步骤；v1 的 `selectEvidence(index)` 使用从零开始的原始信封索引。
`selectGroup(id)` 选择一个范围及其下级，`selectGroup(null)` 返回全部步骤。
不存在的选择返回 `false`。无效输入抛出带 `diagnostics` 的 `EinoViewerError`；
无效更新保留旧视图。`destroy()` 可重复调用，销毁后不能再更新或选择。

对象 API 无法恢复调用方解析 JSON 时已经损失的精度。离线版文件／粘贴入口和工作台示例加载
会在解析前额外校验原始数字文本；工作台没有 Raw 副本编辑器。详见[输入保真边界](#输入保真边界)。

## 阅读规则

v2 三入口共用原生阅读器：显式根结果、可检索和分页的实际调用、关联来源的正文，以及可检查的事件、关系、用量和业务注解。Agent 不画流程；Graph/Workflow 保留定义结构与嵌套范围。复制保留实际记录值；缺失正文不重建。大范围有绘图预算，并提供分页的定义/连线读取入口，不删除记录事实。

v2 的 `selectStep` 使用 invocation ID；`selectEntity({ kind, id })` 选择带类型的实体引用；`selectEvidence(index)` 选择原始 `events[index]`，不是旧信封索引。

下面的详细展示规则适用于原有 v1 阅读器：

- 根结果不与中间或子调用输出混淆，失败保留原始原因和可确认的节点定位；
  执行结果与采集完整度独立，成功运行也可能只采集到部分内容。
- 嵌入／离线 Graph/Workflow 的调用目录和面包屑联动局部路径、步骤/证据列表，以及调用输入、返回和错误。
  整次结果仍可从局部结果上方的折叠摘要查看，原始记录不变。
- Agent 用完整来源地址区分调用，Workflow 按原路径分层，Graph 每次访问保持独立。
  身份不足的事件保留为未归属；子失败可与父成功同时存在，不改写任何一方。
- 三个阅读入口的 Agent 共用连续平铺的轨迹，默认选中首项；无路径图、分页、目录或搜索工具栏。
  详情先输入后输出，正文完整展开且不提供 I/O 复制按钮；主轨迹正文仍可复制。只标明异常状态，
  不同调用的同号回合分开展示，嵌套依据真实父级身份。调用路径可进入局部轨迹，面包屑和整次结果入口负责返回，不提供播放式重放控件。
- Graph 和 Workflow 对**非空且不超过 500 个节点的范围自动绘图**；更大范围需主动绘制，
  空范围不建图。阈值按完整选中范围计算，不按搜索后的匹配数量计算。
- 工作台 Graph 及嵌入／离线 Graph/Workflow 的步骤检索覆盖结构字段：可见名称、ID、状态、路径、调用身份和有证据的调用次数。
  证据检索覆盖信封类型与结构元数据。两者都不索引业务正文或正文摘要，不是全文搜索。
- 展开、复制和来源操作均保留原始值。Agent 默认不显示技术目录，显式 `selectEvidence` API 保留。
  错误预览折叠不等于源内容截断；
  空字符串、null、未采集、脱敏、截断分别表达。耗时取真实边界，不相加并行步骤耗时。

## 低层画布与兼容入口

对 v1，`createEinoViewer` 仍是低层画布入口，供调用方自行组织结果、详情与证据界面。
它不是完整阅读器的别名，现有 API 不变：

```js
import { createEinoViewer } from "eino-viewer";
import "eino-workflow-dag/styles.css";

const canvas = createEinoViewer(document.querySelector("#viewer"), runRecord, {
  onNodeClick({ id, node }) {
    console.log(id, node);
  },
});
```

它同样支持 `update(input)` 与可重复调用的 `destroy()`，无效更新保留旧画布。
节点点击返回 `{ id, node }`：Run Record 使用规范 `ExecutionDAG` 节点，仅定义输入使用源节点。

对 v2，`createEinoViewer` 使用原生阅读器，保留 `kind` / `document` / `update` / `destroy` 小接口；节点点击返回带阅读投影的 invocation。需要选择控制和完整阅读 API 时使用 `createEinoRunViewer`。

主要输入是一份 v1 `EinoRunRecord` 或原生 v2 `RunRecord`。兼容输入包括 schema-v1 `EinoWorkflowSnapshot`、
同次运行的受支持信封，以及经校验的 `EinoViewerDocument`。
`projectEinoViewerDocument()` 返回带稳定 `code`/`path` 的诊断，不抛出输入错误；
不会猜测多次运行混合、来源锚点冲突或缺少锚点的视图。

`eino-viewer` 单向依赖 `eino-workflow-dag@^1.3.1`，原导入、快照、React/Vue 适配器与
渲染行为不变。`eino-viewer/workflow` 继续导出该渲染器。
高级 `/protocol`、`/views`、`/execution-dag`、`/trajectory`、`/explanation` 入口仍保留。
可追加的轨迹 builder 属于兼容 API，不代表实时查看能力；协议记录仍是证据，不是额外的顶层板块。

## 输入保真边界

查看器拒绝不能可靠读取的数据，不改写原值。整数仅接受
`-9007199254740991` 至 `9007199254740991`，超限不舍入或改成字符串。
工作台示例加载与离线版文本导入还会拒绝小数精度丢失和下溢；普通小数及等价指数写法正常接受。
数字形态的字符串仍是字符串；不能安全展开的工具参数 JSON 文本保留原文。
对象 API 无法恢复传入前已经发生的精度损失；文本导入的检查不代表对象入口能追溯原始 JSON。

单份输入限制为 64 MiB、最大深度 128、最多 1,000,000 个值。对象输入按展开后的
紧凑 JSON UTF-8 大小计算。拒绝访问器、稀疏数组等非普通 JSON 数据，不读取 getter。

## 覆盖与维护

[32 个真实 Recorder 场景](https://github.com/silicon-nora/eino-viewer/blob/main/fixtures/recorder-matrix/README.md)
经过真实 Eino Runner/compile/Invoke，模型使用确定性替身，覆盖重复与并行调用、嵌套失败、
取消、中断、脱敏和正文缺失等。运行 `npm run test:recorder-matrix` 检查采集到投影的链路，
或用 `npm run inspect:recorder-matrix -- --strict` 查看静态评估，不需要外部模型服务。

仍保留四项采集/归属限制：两份旧 Graph 记录缺少节点正文；超限 Graph 记录主动省略正文；
部分并行子 Agent 事件缺少足够身份，无法可靠归入调用。采集完整度不会补出缺失数据。
不承诺中断后恢复或任意多 Agent 场景覆盖。

现状见[示例优先与 Agent 轨迹验收](https://github.com/silicon-nora/eino-viewer/blob/main/docs/AGENT_TRAJECTORY_ACCEPTANCE.md)、
[静态结果路线](https://github.com/silicon-nora/eino-viewer/blob/main/docs/STATIC_RESULT_ROADMAP.md)
与[测试维护说明](https://github.com/silicon-nora/eino-viewer/blob/main/tests/README.md)。`npm run benchmark:static` 测量本机
100 / 1,000 / 10,000 条合成证据，不代表真实业务覆盖或性能 SLA。发布不在当前工作范围内。
