# 完成态记录导入与重放：本轮验收

日期：2026-09-22。状态：本轮固定范围已完成，验收通过。未发布。

## 固定范围

本轮交付上一轮计划中的两个 P0：可靠的执行结束事实、用户自己的运行记录导入，
并修复完成态重放的状态一致性。重放只浏览执行完成后的最终记录；不会重新执行
模型、工具或 Workflow，也不模拟历史中间状态。

不做实时订阅、实时回放、公共重放 SDK、Graph/Workflow 轨迹扩展、大记录虚拟化、
自动发布或部署。不修改 `eino-workflow-dag`。当前目录未初始化 Git，本轮不会替用户
创建仓库或提交。

## 验收清单

| 项目 | 验收标准 | 结果 |
| --- | --- | --- |
| 结束事实 | 中间回答和局部工具错误不被视为整次执行结束；记录完成和采集完整度分别表达 | 通过；覆盖取消、未知结果、恢复成功、部分采集 |
| 兼容旧记录 | 旧记录仍可查看，缺少结束事实时不开放完成态重放 | 通过；原 fixtures 保留 |
| 本地导入 | 文件选择、拖放、粘贴均可用；自动识别 Agent、Graph、Workflow | 三浏览器通过；无上传 |
| 原子更新 | 坏 JSON、非法来源、混合 runId 或非法证据被拒绝；原有效视图和选择不变 | 通过；播放中的无效导入也不打断重放 |
| 原始证据 | 压缩 JSON、重复时间戳及内容仍能精确定位对应信封 | 通过；完整信封选中，未应用草稿可恢复 |
| 最终重放 | 自动前进、暂停恢复、末尾停止、切换记录清理、恢复总览均一致 | 通过；计时器测试使用可控时钟 |
| 交付质量 | 核心、类型、Go、三浏览器及真实打包消费者门禁通过 | 通过，详见下表 |
| 仓库隔离 | 原 `eino-workflow-dag` 保持 `main...origin/main` 干净状态 | 开始与结束均已复核，无改动 |

## 人工验收入口

在当前仓库目录启动：

```sh
npm run build:site
python3 -m http.server 4173 --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:4173/.artifacts/pages/?lang=zh`。

1. 默认“多城市出行 Agent”来自实际 Eino ADK 运行：22 条证据，7 条轨迹记录。
2. 切到“轨迹”，点击“重放”，检查暂停、前后一步、拖动进度和“查看最终结果”。
3. 切换“后期失败的出行 Agent”，确认已完成的失败运行仍可重放。
4. 点击“打开运行记录”或拖入下面任意 JSON，来源应自动切换。
5. 导入非法 JSON，确认错误可见而旧结果不变；从步骤打开原始证据应选中完整信封。
6. 打开旧版记录，确认可查看但显示“未记录完成状态”，不开放重放。

新样例均由真实 Recorder 测试生成（模型为确定性测试替身，不调用付费服务）：

- [Agent 成功](../fixtures/eino-agent-recorder-trip-planner-completed-v1.json)
- [Agent 失败](../fixtures/eino-agent-recorder-trip-planner-failure-completed-v1.json)
- [循环 Graph](../fixtures/eino-graph-recorder-cyclic-completed-v1.json)
- [Workflow](../fixtures/eino-workflow-recorder-weather-completed-v1.json)
- [旧版 Agent（无结束事实）](../fixtures/eino-agent-recorder-trip-planner-v1.json)

界面已按前端设计技能沿用现有配色、字体和布局；导入区只增加必要操作。
网页测试技能用于交互、窄屏及无障碍验收，实际使用仓库已有的 Playwright 套件。

[桌面验收截图](../.artifacts/acceptance-desktop.png) ·
[390px 窄屏截图](../.artifacts/acceptance-mobile.png)

## 验证记录与限制

以下均为本轮实际执行结果：

| 检查 | 结果 |
| --- | --- |
| `npm test` | 9 组核心测试通过；新增生命周期负例、真实 Go 完成样例跨语言投影测试 |
| `npm run typecheck` / `npm run check` | 通过；公开声明和类型摘要同步 |
| `npm run build:site` | 通过，产物位于 `.artifacts/pages` |
| Chromium / Firefox / WebKit | **63 / 63 通过**，21 项用例 × 3 浏览器，最终运行 33.5 秒 |
| 窄屏、无障碍、运行时错误 | 390px 布局通过；覆盖 Graph 与 Agent 轨迹；没有严重/关键无障碍违规或页面异常 |
| Eino 0.9.19 | Go 全量 `go test -race ./...`、`go vet ./...` 通过 |
| Eino 0.9.0 | 临时 modfile 离线全量测试通过，未改主 go.mod/go.sum |
| 打包安装消费 | ESM/CJS、TypeScript、Vite、publint、类型审计通过；55 个文件，约 96.7 KiB，低于既有 100 KiB 门禁 |

[浏览器日志](../.artifacts/acceptance-browser.log) ·
[打包验收日志](../.artifacts/acceptance-package.log) ·
[构建日志](../.artifacts/acceptance-build.log)

验收中发现并修复了快速来源切换的旧画布回调、轨迹按钮无障碍状态属性、Go/JS
生命周期校验差异、Eino 原生取消分类、仅定义脱敏时的采集完整度。独立复核确认
后三类问题的修复和回归测试已到位。

### 明确限制与后续范围

- Agent 必须把包装迭代器读取到 `Next() == false`；收到错误后提前退出也不算记录了结束。
- 流式返回对象可能先于真实执行结束。本轮不消费它们，不宣称已结束；完成态流式采集尚未实现。
- 旧记录缺少结束证据，无法安全补造。仍可检查全部已有结果，但不会开放完成态重放。
- Graph/Workflow 本轮支持导入和路径查看；逐步轨迹重放仍仅支持 Agent。
- 重放仍是工作台能力，公共嵌入式控制器、复杂嵌套调用关联和大记录优化留待下一轮。
- 未执行真实付费模型调用，未覆盖全部 Eino 版本，未发布 npm/Go 包或部署网站。
- 当前目录没有 Git 历史；本轮保留本地文件交付，没有创建提交。原仓库保持干净。

本轮没有待修复的阻断项。下一轮应另行确定范围后再推进公共重放能力，不自动扩展本轮目标。
