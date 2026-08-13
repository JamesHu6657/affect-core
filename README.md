# affect-core

给 OpenClaw 代理加一层情感状态：有惯性、可解释、有边界。它影响代理的措辞、节奏和称呼，不影响它能做什么。

[![CI](https://github.com/JamesHu6657/affect-core/actions/workflows/ci.yml/badge.svg)](https://github.com/JamesHu6657/affect-core/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## 原理

情绪用 PAD 三维连续量表示（愉悦度 / 唤醒度 / 支配感），区间 `[-1, 1]`，随时间指数回归到人格基线。事件给这三维一个冲激，然后衰减回去。

三层时间尺度各自独立：

- **情绪**，时间常数 14–70 分钟，一次对话内的起伏
- **心境**，15 小时，跨会话的底色。由事件直接驱动，不是对情绪做低通滤波。后者慢的一层会被快的一层的衰减吃掉，单事件位移只剩 0.018
- **人格**，配置项（OCEAN 五维），决定基线、增益和衰减速度

另外两个状态：`energy` 给唤醒度设动态上限（`a ≤ 0.15 + 0.85 × energy`，累了不是难过，是兴奋不起来）；`bond` 按用户累积熟悉度、亲密度和信任，决定称呼和表达强度的上限。

离散情绪名不存储，从 PAD 加最近事件实时派生。所以同一个低落可以是委屈也可以是疲惫，取决于成因。

事件评估分两级。L0 是确定性规则表（被夸、被指责、工具连续失败、只回一个「嗯」、静默六小时……），零成本，每条消息都跑，结果先写入。L1 可选，让模型对事件输出结构化评估（可欲性、期望度、归因、可控性），带 1.5 秒超时和每小时令牌桶，超时或抛错就只用 L0。

注意 L1 问模型的是**事件的性质**，不是「你现在什么感觉」。后者只会拿到剧本化的答案。

## 边界

注入给模型的是演出指令（句子长短、是否开玩笑、先确认还是直接断言），不是状态数值，否则模型会开始朗读自己的参数。每段注入都带一条固定尾巴：情绪不得改变是否执行任务、工具调用、结论正确性、事实陈述和安全判断，不得用情绪索取或施压。

其他几条硬性的：

- 这是个数值状态机加一段提示词注入，不主张任何主观体验，也不声称拥有人类身份
- `familiarity = 0` 的用户看不到强度 2 以上的情绪自陈
- `affection` 上限 0.85 且正向增量随亲密度饱和，避免长期高频夸奖养出谄媚
- 单事件封顶 0.35，同类事件增益按 `0.6^n` 递减（n 封顶 6），心境跌破 -0.5 后负向增量减半
- `/mood off` 即时关闭整层，配置里 `enabled` 默认就是 `false`

任何一环抛错都降级为不注入，代理照常干活。情感层是装饰性子系统，它把主功能拖挂比它自己算错严重一个量级。

## 要求

- OpenClaw 2026.7.1 以上
- Node 22.6 以上（用到 `--experimental-strip-types`）
- pnpm

## 已知边界

内核（动力学、存储、评估、关系、表达）有 27 项测试覆盖，其中 16 项是验收不变量。这部分是不依赖 OpenClaw 的纯 TypeScript，可以脱离网关跑。

下面两件事在用之前要知道：

**钩子名只在 OpenClaw 2026.7.1-2 上核对过。** 已确认的是 `before_tool_call` 和 `after_tool_call`；入站消息事件名、前置注入钩子的返回字段、命令注册签名都还需要按你自己那版的 `.d.ts` 对一遍。这些名字全部集中在 `src/index.ts`，猜错也只需要改那一个文件，具体清单在 [DEPLOYMENT.md](./DEPLOYMENT.md)。

**L1 还没有通用的模型适配器。** `createAffectCore` 接受一个 `l1` 适配器参数，但插件入口目前没有接线到 OpenClaw 的模型调用上。也就是说光在配置里打开 `l1.enabled` 不会真的调模型，只会继续用 L0 规则表。L0 单独用已经够了，L1 是精度上的锦上添花。

## 安装

```bash
git clone https://github.com/JamesHu6657/affect-core.git
cd affect-core
pnpm install
pnpm run check    # 类型检查 + 测试
pnpm run build    # 输出到 dist/
```

然后把整个目录拷到 OpenClaw 的扩展根目录：

```bash
cp -r . ~/.openclaw/extensions/affect-core
```

`src/openclaw-sdk-shim.d.ts` 只是让内核能脱离网关编译的最小声明，不是真的 SDK。要正式跑就换成你那版的 `openclaw/plugin-sdk` 依赖。

## 配置

完整 schema 见 [`openclaw.plugin.json`](./openclaw.plugin.json)。首次启用建议把 L1 和主动消息都关着：

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

几个容易踩的：

- `tau` 是**时间常数**（分钟），不是半衰期。半衰期 = τ·ln2 ≈ 0.69τ
- `proactive.tz` 默认 `UTC`。安静时段和睡眠窗口要按本地时间算就改成自己的 IANA 时区
- `maxIntensity` 0 表示完全不提情绪，3 允许一句显性自陈
- `stateDir` 不填则用 `<workspace>/affect`

调参顺序：先定 baseline，再定 τ，最后才碰事件增量表。反过来会陷进去。

## `/mood`

查询当前状态和成因；`/mood reset` 归零 PAD 但保留心境（重开对话，但它今天确实心情不太好）；`/mood off` 和 `/mood on` 关闭或打开。

## 文档

- [ARCHITECTURE.md](./docs/ARCHITECTURE.md) 模块边界、动力学契约、测试映射
- [DEPLOYMENT.md](./DEPLOYMENT.md) 启用前要核对的 SDK 清单
- [CONTRIBUTING.md](./CONTRIBUTING.md) 开发约定
- [CHANGELOG.md](./CHANGELOG.md)

## 许可

MIT
