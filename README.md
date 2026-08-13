# affect-core · OpenClaw 情感系统 v0.2 审查包

> **本工程位于 `D:\FM_dev\affect-core`。** 2026-08-13 已部署到 `grok-server` 的 `/root/.openclaw/extensions/affect-core`，L0 开启，L1 与主动消息关闭。

这是按照 ClickUp 中的 *affect-core · OpenClaw 情感系统框架规格 v0.2* 实现的本地审查工程。设计目标是为代理提供具有惯性、可解释且有边界的情感表达层：它仅影响措辞、节奏、断言强度与称呼亲密度，**不改变代理的任务能力、工具调用、事实正确性或安全判断**。

## 已实现内容

| 规格部分 | 本地实现 | 审查状态 |
|---|---|---|
| PAD 情绪、心境、energy、驱力 | `src/types.ts`、`src/dynamics.ts` | 已测试 |
| 时间常数与直接心境耦合 | `src/personality.ts`、`src/dynamics.ts` | 已测试 |
| 单事件封顶、习惯化、螺旋抑制 | `src/dynamics.ts` | 已测试 |
| L0 规则层与事件日志 | `src/appraise-l0.ts` | 已测试 |
| L1 缓存、1.5 秒超时、令牌桶 | `src/appraise-l1.ts`、`src/budget.ts` | 已测试 |
| 串行状态存储与原子快照 | `src/store.ts` | 已测试 |
| 关系层不对称与亲密度饱和 | `src/bonds.ts` | 已测试 |
| 强度分档与表达硬约束 | `src/derive.ts`、`src/express.ts` | 已测试 |
| `/mood` / reset / off 逻辑 | `src/commands.ts` | 已测试 |
| OpenClaw 入口桥接 | `src/index.ts` | 待目标 SDK 签名最终核对 |

## 快速审查

在 Windows 终端中执行：

```powershell
cd D:\FM_dev\affect-core
pnpm run check
```

`check` 会先做严格 TypeScript 类型检查，再执行 27 项自动化测试，其中包含规格要求的 16 条验收不变量，以及寂寞时钟、L1 配额、驱力满足、`/mood` 出口和 energy 包络等旁路回归。当前运行结果应为 **27 passed / 0 failed**。

## 目录结构

```text
D:\FM_dev\affect-core
├── docs/
│   └── ARCHITECTURE.md        架构、映射与兼容性边界
├── src/
│   ├── dynamics.ts            纯函数动力学内核
│   ├── store.ts               串行队列与原子快照
│   ├── appraise-l0.ts         确定性评估
│   ├── appraise-l1.ts         L1 超时、缓存与映射
│   ├── bonds.ts               关系层
│   ├── derive.ts              强度与标签派生
│   ├── express.ts             导演指令与硬约束
│   ├── commands.ts            /mood 命令逻辑
│   ├── core.ts                业务编排
│   └── index.ts               OpenClaw SDK 适配边界
├── test/
│   └── invariants.test.ts     规格不变量测试
├── openclaw.plugin.json       默认 disabled 的插件清单
└── DEPLOYMENT.md              审查后部署步骤
```

## 关键审查结论

`τ` 被实现为**时间常数**而非半衰期；默认值为 `a=14`、`v=55`、`d=70`、`mood=900` 分钟。心境不是采样已经衰减的 valence，而是在每次事件发生后直接按 `effectiveΔv × 0.25` 位移，然后以独立的 900 分钟时间常数回归。该实现避免了 v0.1 中心境响应仅约为 `0.018` 的静默失效。

所有状态变更先经过 L0 确定性评估并写入串行队列；L1 是后置精修，配额耗尽、超时或抛错时不会影响回复或已经写入的 L0 结果。状态文件损坏、读取失败或表达层失败时均回落为基线或空注入，确保核心代理功能不受影响。

## 需要重点核对的部署前事项

本地工程已与服务器只读确认的 OpenClaw `2026.7.1-2` 插件模型保持一致，并确认了 `definePluginEntry`、`api.on(...)`、`before_tool_call` 和 `after_tool_call`。但以下 SDK 接口在该版本中需要在部署前通过实际 `.d.ts` 逐项最终对齐：入站消息事件名与字段、前置代理提示注入事件的返回字段、会话重置、cron 与命令注册签名。

这类不确定性**被限定在 `src/index.ts`**，不会影响本工程的动力学、评估、关系、存储和表达层审查。请勿在未核对 `DEPLOYMENT.md` 的情况下把该目录复制到服务器扩展根目录。
