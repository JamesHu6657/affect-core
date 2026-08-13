# 更新日志

## 未发布

- 加 MIT 许可证、CI（Node 22/24 跑 typecheck、test、build）、CONTRIBUTING、SECURITY、issue 与 PR 模板
- 修：状态目录兜底不再硬编码 `/root/...`，改为显式配置 → `api.workspacePath` → 配置里的 workspace → `OPENCLAW_WORKSPACE` → 当前用户 home。非 root 安装此前会把状态写到 workspace 之外
- 修：时区兜底改为 `UTC`，安静时段和睡眠窗口需显式配置 `proactive.tz`
- 文档去掉本机路径和主机名；测试数从 18 更正为 27

## 0.2.0-review - 2026-08-13

首个完整实现。相对 0.1 设计稿的改动：

- 心境层此前实质失效。`mood` 做的是 `pad.v` 的低通滤波，而 `pad.v` 已按 55 分钟时间常数回归，级联衰减让单事件的心境位移只剩约 0.018。改为事件直接耦合 `mood += effectiveΔv × 0.25` 并独立回归，同一事件位移变为 0.075
- L1 评估无超时无降级，且在消息钩子里同步 await，模型挂起会拖断整条回复链。改为 L0 先落地、L1 事后精修、1.5 秒超时、不重试、整段 fail-open
- 消息钩子与心跳各自 read-改-write，丢失更新。原子 rename 只保证文件不半写，不提供互斥。改为单一内存所有者加 Promise 串行队列
- 时钟回拨会永久冻结情绪演化（`dt <= 0` 时直接 return 且不更新 `updatedAt`）。改为不推进但对齐时钟，同时把 `dt` 钳到 48 小时
- 习惯化计数无上限，`0.6^n` 下溢到 0，而每 30 分钟只减 1，恢复要上百小时。`n` 封顶 6，归零删键
- `maxRatePerHour` 只是配置里的一个数字，没有强制点。改为令牌桶
- `τ ≤ 0` 会让 `exp(+Infinity)` 产出 NaN 并污染状态文件。加正数校验，损坏文件 fail-open 到基线
- `affection` 缺少饱和上限，长期高频夸奖会导致谄媚漂移。上限 0.85
- `capArousal` 只在 `impulse` 里生效，`tick` 之后不约束。energy 包络现在覆盖两条路径
- 心跳先 tick 再算静默时长，六小时静默事件永不触发。改为 tick 前捕获
- 全局 `enabled: false` 与 `/mood off` 之后仍会积累事件。四条路径加开关门控
- τ 统一为时间常数而非半衰期（原文档混用，照着调差 31%）
- 配置键统一为 `tau.mood`（实现此前读 `moodTau`）
- 强度档位 0 强制显示「平和」，与注入片段的「不提及任何情绪」对齐
- `proactive` 加 `tz`，此前只有时间字符串没有时区来源
