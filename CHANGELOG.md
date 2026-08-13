# 更新日志

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

- MIT 许可证、`package.json` 元数据（仓库、作者、关键词、bug 追踪）
- GitHub Actions CI：Node 22 与 24 上跑类型检查、测试和构建
- CONTRIBUTING、SECURITY、CODE_OF_CONDUCT、issue 与 PR 模板、`.editorconfig`
- README 增加安装、配置表、`/mood` 说明与明确的边界伦理声明

### 修复

- 状态目录兜底不再硬编码 `/root/...`：依次解析显式配置、`api.workspacePath`、配置里的 workspace、`OPENCLAW_WORKSPACE`，最后回落当前用户 home。非 root 安装此前会把状态写到自身 workspace 之外。
- 时区兜底从部署者本地时区改为 `UTC`，安静时段与睡眠窗口需显式配置 `proactive.tz`

### 变更

- 文档移除私有主机名与本地开发路径
- `docs/REVIEW.md` 的测试数从 18 更正为 27（旁路回归补齐后未同步）
- `DEPLOYMENT.md` 修正关于构建配置的过期说明（`tsconfig.build.json` 已存在）

## [0.2.0-review] - 2026-08-13

首个完整实现。相对 v0.1 设计稿的关键修复，按后果排序：

### 修复

- **心境层此前实质失效。** v0.1 把 `mood` 做成 `pad.v` 的低通滤波，而 `pad.v` 已按 55 分钟时间常数回归基线，级联衰减使单事件的心境位移仅约 `0.018`。心境看起来在实现里，实际上是个常量，三层时间尺度只在文档里成立。改为事件直接耦合 `mood += effectiveΔv × 0.25` 并独立慢回归，同一事件位移变为 `0.075`。
- **L1 模型评估此前无超时无降级**，且在消息钩子里同步 await，模型挂起会拖断整条回复链。改为 L0 先落地、L1 事后精修、1.5 秒硬超时、不重试、整段 fail-open。
- **状态并发丢失更新。** 消息钩子与心跳各自 read-改-write；原子 rename 只保证文件不半写，不提供互斥。改为单一内存所有者 + Promise 串行队列，定期 flush 落盘。
- **时钟回拨会永久冻结情绪演化**（`dt <= 0` 时直接 return 且不更新 `updatedAt`）。改为不推进但对齐时钟，同时把 `dt` 上限钳到 48 小时，防长停机后线性项爆量。
- 习惯化计数无上限，`0.6^n` 会下溢到 0，且每 30 分钟只减 1，恢复需上百小时，等于把一整类事件锁死一天。`n` 封顶 6（系数地板 0.047），归零删键。
- `maxRatePerHour` 此前只是配置里的一个数字，没有任何强制点。改为令牌桶。
- 配置未校验，`τ ≤ 0` 会让 `exp(+Infinity)` 产出 NaN 并污染整个状态文件。加正数校验与损坏文件 fail-open。
- `affection` 缺少饱和上限，长期高频夸奖会导致谄媚漂移。硬上限 0.85，正向增量随亲密度衰减。
- `capArousal` 此前只在 `impulse` 里生效，`tick` 之后不约束。energy 包络现在覆盖冲激与衰减两条路径。
- 心跳先 tick 再算静默时长，导致 6 小时静默事件永不触发。改为 tick 前捕获静默时长。
- 全局 `enabled: false` 与 `/mood off` 之后仍会积累事件。四条路径全部加开关门控。

### 变更

- 文档统一：`τ` 是**时间常数**而非半衰期（v0.1 混用，照文档调参会有 31% 偏差）
- 配置键统一为 `tau.mood`（实现此前读的是 `moodTau`）
- 强度档位 0 强制显示「平和」，与注入片段的「不提及任何情绪」保持一致
- `proactive` 增加 `tz`，此前只有时间字符串没有时区来源
