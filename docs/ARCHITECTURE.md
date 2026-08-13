# 架构

内核不依赖 OpenClaw 运行时，可以脱离网关跑测试。SDK 接线是实验性的，集中在 `src/index.ts`。

## 分层

```text
消息／工具事件
      │
      ├── L0 规则评估 ───┐
      ├── L1 模型精修 ───┼─> store.mutate()
      └── 心跳 ─────────┘        │
                                 ▼
                    tick() → impulse() → state.json
                                 │
                        前置注入钩子（fail-open）
                                 ▼
               derive() → renderStageNotes() → 系统提示追加
```

所有钩子 fail-open：状态、模型评估、存储或注入出异常时，代理照常运行，只是不注入。

## 文件

| 文件 | 责任 |
|---|---|
| `types.ts` | 状态、人格、评估、关系、事件与适配器的类型定义 |
| `personality.ts` | OCEAN 配置到 baseline、gain、时间常数的转换，非法值回落默认 |
| `dynamics.ts` | 惰性 tick、冲激、习惯化、螺旋抑制、energy 包络。纯函数，零 I/O |
| `store.ts` | 缓存、串行队列、JSON 消毒、原子持久化 |
| `budget.ts` | L1 令牌桶 |
| `appraise-l0.ts` | 确定性规则层 |
| `appraise-l1.ts` | 结构化评估的缓存、超时与降级 |
| `bonds.ts` | 按用户的关系状态与不对称更新 |
| `derive.ts` | PAD、最近事件、关系到标签和强度档位 |
| `express.ts` | 注入片段与硬约束尾巴 |
| `commands.ts` | `/mood` 的纯处理逻辑 |
| `clock.ts` | 时区、安静时段、睡眠窗口。非法 IANA 名回落 UTC |
| `index.ts` | OpenClaw SDK 适配层 |

`dynamics.ts` 保持纯函数是有原因的：它能用假时间戳跑几千步，全部自动化验证都建立在这一点上。

`store.ts` 里内存是唯一真相源，磁盘只是快照。串行队列的 `chain.then(fn, fn)` 两个位置传同一个函数，是为了让一次异常不把队列卡死。

## 动力学

```text
x(t + Δt) = base + (x(t) − base) × exp(−Δt / τ)
Δt = min(max(0, now − updatedAt), 48h)
mood = clamp(mood + effectiveDelta.v × 0.25)
silence = now − lastInteractionAt
```

每次读取或变异前先跑一次惰性 `tick`，按实际时间差推进，重启或休眠不会让情感冻结。`Δt` 的下界吸收时钟回拨，上界防止长停机后线性累积的驱力项爆量。

τ 单位是分钟：`a=14`、`v=55`、`d=70`、`mood=900`。所有维度在冲激和 tick 之后都做范围钳制。

energy 不降低任务能力，只设唤醒度包络 `a ≤ 0.15 + 0.85 × energy`。高唤醒的消耗按衰减过程中的 arousal 积分，睡眠回复按 `[now−Δt, now]` 与 23:00–08:00 的重叠计时，这样长停机不会把 energy 一次扣光。

静默判定用 `lastInteractionAt`，心跳的 `tick` 只推进 `updatedAt`。每个静默回合只发一次 `lonely`，之后才允许 `unmet`。驱力随时间累积，对应事件（接触 / 夸奖 / 新领域 / 交付）会清零，`unmet` 只在缺口持续超过一小时后触发。睡眠窗口内心境额外向基线拉回 30%，按区间内未覆盖的睡眠周期各算一次。`/mood` 先 tick 再改状态。

三重闸门：

| 闸门 | 位置 | 规则 |
|---|---|---|
| 单事件封顶 | `impulse` | 每维有效位移绝对值不超过 0.35 |
| 习惯化 | `impulse` + `tick` | 同 tag 增益乘 `0.6^min(n, 6)`，每 30 分钟衰减一层，归零删键 |
| 螺旋抑制 | `impulse` | 负向一致性增益最多 1.3；mood < −0.5 时再乘 0.5；mood < −0.6 时心境耦合再乘 0.4 |

心境一致性增益（心情差时坏消息更痛）是刻意保留的，它天生正反馈，所以上限、地板和睡眠回归三个都不能少。

## SDK 适配

入站消息事件名、前置注入钩子的返回字段、会话重置与心跳注册的精确签名，需要按目标环境 `openclaw/plugin-sdk` 的声明校正。所以：

- `src/index.ts` 用窄接口声明适配器形状，不让不确定的字段扩散进内核
- 所有业务函数可以脱离 OpenClaw 在 Node 测试里直接调用
- 已确认的工具前后置钩子直接接入，其他候选钩子用可选调用，缺失时跳过对应能力
- `openclaw.plugin.json` 有完整 schema，但默认 `enabled: false`

## 测试映射

27 项测试全在 `test/invariants.test.ts`，其中 1–16 对应验收不变量：

- 1–4 边界、单事件上限、习惯化与键清理
- 5–10 mood 直接耦合、时间演化、时钟回拨、长停机、非法 τ
- 11–12 L1 fail-open 和令牌桶上限
- 13 200 次 mutate 与 50 次 tick 并发下的无丢失更新
- 14–16 affection 上限、陌生人强度、硬约束尾巴

剩下 11 项是旁路回归：寂寞时钟、L1 缓存不耗配额、驱力满足、`/mood` 出口、睡眠心境、energy 包络。

判据不是「看起来像有情绪」，而是不变量可执行、每次状态变更可解释、任何故障都不影响代理干活。
