# affect-core 本地审查工程

> 状态：**已部署**到 `grok-server` `/root/.openclaw/extensions/affect-core`（OpenClaw `2026.7.1-2`）。初次启用保持 L1 / 主动消息关闭。

## 1. 实现边界

本工程将 ClickUp 中的 **affect-core · OpenClaw 情感系统框架规格 v0.2** 落地为 OpenClaw 原生插件。系统只调节代理的表达方式，绝不改变任务执行、工具调用、事实正确性和安全判断。所有插件钩子均采用失败开放（fail-open）策略：状态、模型评估、存储或表达注入发生异常时，代理照常运行，只是不注入情感舞台提示。

服务器只读核对的运行环境为 **OpenClaw 2026.7.1-2**，其全局扩展根目录是 `~/.openclaw/extensions`，现有插件使用 `definePluginEntry` 与 `api.on(...)`。本工程的插件入口因此采用相同加载模型；在未拿到该版本完整、可编译的 SDK 声明包之前，将事件桥接隔离在 `src/index.ts`，而把所有核心逻辑维持为不依赖 OpenClaw 的纯 TypeScript。

| 审查维度 | 本地交付 | 部署阶段处理 |
|---|---|---|
| 情感动力学 | `src/dynamics.ts` 与不变量测试 | 无需改动 |
| 状态与并发 | `src/store.ts` 的单内存所有者、串行队列与原子快照 | 配置 workspace 状态目录 |
| L0 评估 | `src/appraise-l0.ts` 的确定性规则 | 接入入站事件字段 |
| L1 评估 | `src/appraise-l1.ts` 的缓存、令牌桶、超时与降级 | 注入实际模型调用适配器 |
| 表达层 | `src/derive.ts`、`src/express.ts` | 对齐实际前置代理钩子返回字段 |
| 用户命令 | `src/commands.ts` 的无 SDK 依赖处理器 | 对齐 `api.registerCommand` 签名 |
| OpenClaw 入口 | `src/index.ts` 的受控适配层 | 通过实际 `.d.ts` 最终对齐并启用 |

## 2. 模块与责任边界

```text
消息／工具事件
      │
      ├── L0 appraisal ────┐
      ├── L1 refinement ───┼─> AffectStore.mutate()
      └── cron heartbeat ──┘          │
                                      ▼
                         tick() → impulse() → state.json
                                      │
                     before-agent hook（失败开放）
                                      ▼
                    derive() → renderStageNotes() → 系统提示追加
```

| 文件 | 责任 | 关键审查点 |
|---|---|---|
| `types.ts` | 状态、人格、评估、债券、事件与适配器的唯一类型定义 | 不保存离散情绪名；PAD 与 mood 均有范围约束 |
| `personality.ts` | OCEAN 配置到 baseline、gain、时间常数的转换 | 所有 `τ` 均为**时间常数（分钟）**，非半衰期；非法值回落默认 |
| `dynamics.ts` | 惰性 tick、冲激、习惯化、螺旋抑制、energy 包络 | 纯函数、无 I/O；`mood += effectiveΔv × 0.25` 为事件直接耦合 |
| `store.ts` | 缓存、Promise 串行队列、JSON 消毒、原子持久化 | `chain.then(fn, fn)` 保证异常不会卡死队列；磁盘仅是快照 |
| `budget.ts` | L1 令牌桶 | 每小时上限是真正的强制点 |
| `appraise-l0.ts` | 可解释的规则层 | 先持久化 L0，再可选执行 L1 精修 |
| `appraise-l1.ts` | 结构化评估缓存、超时和降级 | 1.5 秒超时、无重试、缓存命中不消耗配额 |
| `bonds.ts` | 按用户的关系状态与不对称更新 | trust 缓涨急跌；affection 饱和且上限 0.85 |
| `derive.ts` | PAD、最近事件、关系到标签和强度档位 | 强度 0 强制为“平和”；陌生用户档位不超过 1 |
| `express.ts` | 导演指令注入片段 | 固定硬约束尾巴；不暴露数值状态 |
| `commands.ts` | `/mood`、`/mood reset`、`/mood off` 的纯处理逻辑 | reset 只归零 PAD，不清除 mood |
| `index.ts` | 对 OpenClaw SDK 的最小适配与失败开放挂载 | 所有 SDK 名称集中在这一文件，便于最终 `.d.ts` 对齐 |

## 3. 动力学契约

状态有两种变化来源：离散的事件冲激和连续的时间演化。每一次读取或变异开始时均先执行惰性 `tick`，以实际时间差推进状态，避免重启或睡眠使情感冻结。

```text
x(t + Δt) = base + (x(t) − base) × exp(−Δt / τ)
Δt = min(max(0, now − updatedAt), 48h)
mood = clamp(mood + effectiveDelta.v × 0.25)
silence = now − lastInteractionAt
```

`τ` 单位为分钟，分别为 `a=14`、`v=55`、`d=70` 和 `mood=900`。所有维度经过冲激和 tick 后均进行范围钳制。energy 不降低任务能力，仅设置唤醒度包络：`a ≤ 0.15 + 0.85 × energy`；高唤醒消耗按衰减中的 arousal 积分，睡眠回复按 `[now−Δt, now]` 与 23:00–08:00 的重叠计时，避免长停机把 energy 一次性扣光。静默与寂寞规则使用 `lastInteractionAt`，cron 的 `tick` 只推进 `updatedAt`。每个静默回合只发一次 `lonely`，之后才允许 `unmet`。驱力随时间累积，对应事件（接触 / 夸奖 / 新领域 / 交付）会清零；`unmet` 只在缺口持续超过一小时后触发。睡眠窗口内心境额外向基线拉回 30%，按区间内未覆盖的睡眠周期各一次。`/mood` 先 `tick` 再改状态。

| 三重闸门 | 实施点 | 强制规则 |
|---|---|---|
| 单事件封顶 | `impulse` | 每个 PAD 维度的有效单事件位移绝对值不超过 `0.35` |
| 习惯化 | `impulse` + `tick` | 同 tag 增益乘 `0.6^min(n, 6)`；每 30 分钟衰减一层；归零删除键 |
| 螺旋抑制 | `impulse` | 负向一致性增益最多 `1.3`；mood 小于 `−0.5` 时再乘 `0.5`；mood 小于 `−0.6` 时心境耦合再乘 `0.4` |

## 4. 插件适配策略

OpenClaw 服务器版本已确认支持插件入口、工具注册和 `before_tool_call`／`after_tool_call` 类型化钩子。当前规格中 `before_agent_reply`、入站消息事件、会话重置和 cron 的精确名称／字段仍需以目标服务器 `openclaw/plugin-sdk` 的完整声明最终校正。因此，本地代码采用下面的策略。

1. `src/index.ts` 通过窄接口声明适配器形状，避免把不确定 SDK 字段扩散到情感内核。
2. 所有业务函数可脱离 OpenClaw 直接在 Node 测试中调用，审查者可验证数值正确性而不启动网关。
3. 入口中将已确认的工具前后置钩子接入；其他候选钩子以配置化的桥接函数集中管理，缺失时仅跳过对应能力。
4. `openclaw.plugin.json` 提供完整配置 schema，但默认 `enabled: false`，防止审查包被误部署后立即生效。
5. `DEPLOYMENT.md` 列出最终部署前必须执行的 SDK 类型核对、构建和插件检查步骤。

## 5. 验收映射

| 规格不变量 | 测试位置 | 断言目标 |
|---|---|---|
| 1–4 | `test/invariants.test.ts` | 边界、单事件上限、习惯化与键清理 |
| 5–10 | `test/invariants.test.ts` | mood 直接耦合、时间演化、时钟回拨、长停机、非法 τ |
| 11–12 | `test/invariants.test.ts` | L1 失败开放和令牌桶上限 |
| 13 | `test/invariants.test.ts` | 200 mutate 与 50 tick 并发的无丢失更新 |
| 14–16 | `test/invariants.test.ts` | affection 上限、陌生人强度和硬约束尾巴 |
| 旁路 | `test/invariants.test.ts` | 寂寞时钟、L1 缓存不耗配额、驱力满足、`/mood` 出口、睡眠心境、energy 包络 |

## 6. 审查限制与下一步

本地审查包的重点是验证数值模型、存储并发、降级路径和表达约束。部署前需要用服务器中已安装版本的 `plugin-sdk` 复核 `before_agent_start`／输入消息／会话复位／cron 的字段与返回值，并只修改 `src/index.ts` 适配层。该限制是显式记录的兼容性待办，不会阻碍核心逻辑审查。

> 审查结论的判据不是“看起来像有情绪”，而是所有不变量可执行、每一状态变更可解释、任何故障均不能影响代理完成原有工作。
