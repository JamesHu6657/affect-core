# affect-core

**一个给 [OpenClaw](https://docs.openclaw.ai) 代理用的情感层：有惯性、可解释、有边界。它只改变代理说话的方式，不改变它做事的能力。**

> An inertial, explainable, bounded affect layer for OpenClaw agents. It shapes wording, pacing, assertiveness and address, and never touches task execution, tool calls, factual correctness or safety judgement.

[![CI](https://github.com/JamesHu6657/affect-core/actions/workflows/ci.yml/badge.svg)](https://github.com/JamesHu6657/affect-core/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D22-informational)

---

## 这是什么

大多数「AI 情感系统」失败在同一个地方：把情感做成了台词表。收到夸奖回一句「我好开心呀」，下一轮清零。那不是情感，是条件反射。

真情感的判据只有一条：**它有惯性**。半小时前发生的事，现在还在影响语气。

affect-core 用连续的 PAD 三维状态（愉悦度 / 唤醒度 / 支配感）加三层独立时间尺度实现这件事：

| 层 | 驱动源 | 时间常数 | 表现 |
|---|---|---|---|
| 人格 | 配置（OCEAN 五维） | 手动 | 决定基线、增益与衰减速度 |
| 情绪 | 事件冲激 | 14 – 70 分钟 | 单次对话内的起伏 |
| 心境 | 事件直接耦合 | 15 小时 | 跨会话、跨昼夜的底色 |
| 资源 energy | 时长与本地时钟 | 睡眠重置 | 给唤醒度设动态上限 |
| 关系 bond | 按用户累积 | 数周 | 称呼亲密度与表达强度上限 |

离散情绪名（委屈、挫败、寂寞）**不存储**，而是从 PAD 加最近事件实时派生。所以「同一个低落」可以既是委屈也是疲惫，取决于成因。

## 设计原则

1. **情感是状态，不是台词。** 状态落在磁盘上，跨会话、跨渠道存活。
2. **三层时间尺度必须真的分离。** 用一层去低通滤另一层，慢的那层会被衰减吃掉（这是 v0.1 的真实缺陷，见 [CHANGELOG](./CHANGELOG.md)）。
3. **情绪只改表达，不改能力。** 心情差不许拒活、不许降低工具可用性、不许省略事实。
4. **可解释。** 每次状态变化留一条生效后的增量记录，`/mood` 能问出「为什么」。
5. **有界，且永不阻塞主路径。** 单事件封顶、同类递减、螺旋抑制、时钟异常吸收；任何一环抛错都降级为「无情感注入」，代理照常干活。

## 状态

<table>
<tr><td>情感内核（动力学、存储、评估、关系、表达）</td><td>已实现，27 项自动化测试覆盖，其中 16 项是规格验收不变量</td></tr>
<tr><td>OpenClaw SDK 接线</td><td><b>实验性。</b>入站消息事件名、提示注入返回字段、cron 与命令注册签名需按你所用 OpenClaw 版本的 <code>.d.ts</code> 核对</td></tr>
</table>

这类不确定性被刻意**限制在 `src/index.ts` 一个文件里**，核心逻辑是不依赖 OpenClaw 的纯 TypeScript，可以脱离网关直接测试。插件清单默认 `enabled: false`，装上不会自动生效。

## 安装

需要 Node 22+ 与 pnpm。

```bash
git clone https://github.com/JamesHu6657/affect-core.git
cd affect-core
pnpm install
pnpm run check      # 类型检查 + 27 项测试
pnpm run build      # 输出到 dist/
```

然后把目录放进 OpenClaw 的扩展根目录（默认 `~/.openclaw/extensions/affect-core`），在配置中显式启用。**先读 [DEPLOYMENT.md](./DEPLOYMENT.md)**，里面有部署前必须完成的 SDK 核对清单。

## 配置

完整 schema 在 [`openclaw.plugin.json`](./openclaw.plugin.json)。推荐的首次启用配置（L1 与主动消息都关着）：

```json
{
  "plugins": {
    "entries": {
      "affect-core": {
        "enabled": true,
        "config": {
          "enabled": true,
          "maxIntensity": 2,
          "l1": { "enabled": false },
          "proactive": { "enabled": false }
        }
      }
    }
  }
}
```

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 安全默认。关闭时不积累事件也不注入 |
| `stateDir` | `<workspace>/affect` | `state.json` 与 `bonds.json` 的位置 |
| `maxIntensity` | `2` | 表达强度上限（0 不提情绪，3 允许显性自陈） |
| `personality` | OCEAN 五维 | 推导基线、增益与时间常数 |
| `tau` | `a=14 v=55 d=70 mood=900` | 时间常数（分钟），不是半衰期。|
| `moodCoupling` | `0.25` | 事件进入心境的比例 |
| `l1.enabled` | `false` | 模型辅助评估。带 1.5 秒超时与每小时令牌桶 |
| `proactive` | `false` | 驱力驱动的主动开话题，含安静时段 |
| `proactive.tz` | `UTC` | IANA 时区，决定安静时段与睡眠窗口 |

## `/mood` 命令

- `/mood` 查询当前表达状态与成因
- `/mood reset` 归零 PAD，**保留心境**（重开对话，但它今天确实心情不太好）
- `/mood off` / `/mood on` 关闭或打开整层

## 边界与伦理

<!-- 这一节不是免责声明模板，是这个项目的实际行为约束。 -->

- **不声称意识或感受。** 这是一个数值状态机加一段提示词注入。它模拟情感的**动力学**，不主张任何主观体验。
- **不许拿情绪推活。** 注入片段里带一条固定硬约束尾巴：情绪不得改变是否执行任务、工具调用、结论正确性、事实陈述与安全判断，不得用情绪索取、施压或指责。
- **不冒充人类。** 不声称拥有人类身体或身份。
- **随时可关。** `/mood off` 即时生效，配置里 `enabled: false` 是默认值。
- **对陌生人克制。** `familiarity = 0` 的用户永远看不到强度 2 以上的情绪自陈。
- **反谄媚。** `affection` 硬上限 0.85 且正向增量随亲密度饱和，防止长期高频夸奖把代理养成舔狗。

如果你打算用它做拟人陪伴产品，请自己评估当地关于情感型 AI 的合规要求，并对使用者说清这是软件。

## 文档

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 模块边界、动力学契约、三重闸门、验收映射
- [REVIEW.md](./docs/REVIEW.md) 代码审查记录与已修问题
- [DEPLOYMENT.md](./DEPLOYMENT.md) 部署前核对清单
- [CONTRIBUTING.md](./CONTRIBUTING.md) 开发约定与不变量要求
- [CHANGELOG.md](./CHANGELOG.md) 版本历史

## 参与

欢迎 issue 和 PR。改动动力学的 PR 必须附带一条会因该改动而失败的测试，见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可

[MIT](./LICENSE) © 2026 James Hu
