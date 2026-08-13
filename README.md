# affect-core · OpenClaw 情感系统 v0.2 审查包

> **本工程位于 `D:\FM_dev\affect-core`。** 2026-08-13 已部署到 `grok-server` 的 `/root/.openclaw/extensions/affect-core`，L0 开启，L1 与主动消息关闭。

这是按照 ClickUp 中的 *affect-core · OpenClaw 情感系统框架规格 v0.2* 实现的本地审查工程。设计目标是为代理提供具有惯性、可解释且有边界的情感表达层：它仅影响措辞、节奏、断言强度与称呼亲密度，**不改变代理的任务能力、工具调用、事实正确性或安全判断**。

## 快速审查

```powershell
cd D:\FM_dev\affect-core
pnpm run check
```

`check` 会先做严格 TypeScript 类型检查，再执行 27 项自动化测试。当前运行结果应为 **27 passed / 0 failed**。
