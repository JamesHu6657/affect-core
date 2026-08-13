# 启用前要做的事

内核已经有测试覆盖，但 SDK 接线必须按你自己的 OpenClaw 版本核对，否则别启用。

## 1. 本地跑通

```bash
pnpm install
pnpm run check
```

预期 TypeScript 无错，27 项测试全过。覆盖状态边界、心境耦合、时钟回拨、长停机、非法时间常数、L1 降级、配额、并发、关系饱和、陌生用户强度、硬约束尾巴、寂寞时钟、驱力满足、`/mood` 出口和 energy 包络。

## 2. 核对 SDK

入口按 OpenClaw `2026.7.x` 的插件模型写的（`definePluginEntry` + `api.on(...)`，`before_tool_call` / `after_tool_call` 已确认）。其余候选桥接都在 `src/index.ts` 里，逐个核对：

| 候选 | 要确认什么 |
|---|---|
| `message_received` | 真实入站事件名；文本、用户 ID、消息 ID 字段 |
| `before_prompt_build` / `before_agent_start` | 哪个是正确的前置钩子；提示追加字段是 `appendSystemContext`、`systemAppend` 还是别的 |
| `after_tool_call` | 工具名、耗时、错误、session 字段 |
| `gateway_stop` | 正确的退出事件名 |
| 心跳 | 是否有原生 cron 注册可以替掉内置的 `setInterval` |
| `registerCommand` | `/mood` 的命令定义和返回形状 |

改动只允许发生在 `index.ts` 的事件名和字段映射上，核心代码不动。前置注入钩子失败时必须返回空对象。

只读排查（路径按你的安装方式调整）：

```bash
openclaw --version
openclaw plugins inspect affect-core --runtime --json

grep -R -n -E 'before_agent|before_prompt|after_tool_call|registerCommand' \
  "$(npm root -g)/openclaw/dist/plugin-sdk" --include='*.d.ts'
```

## 3. 构建

`tsconfig.json` 是 `noEmit`，发布用 `tsconfig.build.json` 输出到 `dist/`：

```bash
pnpm run build
```

`src/openclaw-sdk-shim.d.ts` 只是让内核能脱离网关编译的最小声明，不是生产 SDK。部署前换成你所用版本的真实 `openclaw/plugin-sdk` 依赖。

顺序：复制到临时目录 → 安装匹配版本的依赖 → 编译 → `openclaw plugins inspect --runtime` 确认钩子和命令都在 → 最后才移到扩展根目录并启用。

## 4. 首次启用

清单里 `enabled` 默认 `false`。第一次开的时候把 L1 和主动消息都关着，先验证 L0 的 `praise`、`blame`、`achieve` 和前置注入，再逐步打开关系层、心跳、L1 和副语言。

```json
{
  "plugins": {
    "entries": {
      "affect-core": {
        "enabled": true,
        "config": {
          "enabled": true,
          "maxIntensity": 2,
          "l1": { "enabled": false, "maxRatePerHour": 12, "timeoutMs": 1500 },
          "proactive": { "enabled": false, "quietHours": ["23:30", "08:00"], "tz": "UTC" }
        }
      }
    }
  }
}
```

`proactive.tz` 默认 `UTC`，要按本地时间算安静时段就改成自己的 IANA 时区。

## 5. 上线后看这几条

表达层异常时回复仍正常；工具失败两次只影响语气、不降低工具调用；`/mood reset` 归零 PAD 但保留 mood；状态文件损坏后以基线恢复；频繁夸奖推不过 `affection` 0.85；陌生用户不出现档位 2 或 3 的显性自陈。

只要有一项影响到任务是否执行、工具能否调用、事实是否完整或安全判断是否生效，立刻关掉，去适配层查。
