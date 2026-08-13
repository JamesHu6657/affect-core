# affect-core 部署前检查清单

> 本清单故意把「复制到服务器并启用插件」放在最后。核心逻辑已通过自动化验证，但 SDK 接线必须按你自己的 OpenClaw 版本核对，否则不要启用。

## 1. 审查通过条件

在仓库根目录执行：

```bash
pnpm install
pnpm run check
```

通过标准为 TypeScript 严格检查成功，且 `test/invariants.test.ts` 的 **27 项测试全部通过**。测试覆盖状态边界、心境直接耦合、时钟回拨、长停机、非法时间常数、L1 降级、配额、并发、关系饱和、陌生用户强度、表达硬约束、寂寞时钟、驱力满足、`/mood` 出口和 energy 包络。

## 2. 在目标服务器只读核对 SDK

本仓库的入口按 OpenClaw `2026.7.x` 的插件模型编写（`definePluginEntry` + `api.on(...)`，已确认 `before_tool_call` / `after_tool_call`）。部署前必须在**你自己的**环境里读取实际声明，核对 `src/index.ts` 中隔离的候选桥接。

| 本地候选桥接 | 必须核对的问题 | 处理规则 |
|---|---|---|
| `message_received` | 真实入站事件名；文本、用户 ID、消息 ID 字段 | 仅修改 `index.ts` 的事件名和读取字段 |
| `before_prompt_build` / `before_agent_start` | 哪个是正确的前置钩子；提示追加字段是 `appendSystemContext`、`systemAppend` 还是其他 | 仅修改返回对象字段；失败必须返回空对象 |
| `after_tool_call` | 工具名、耗时、错误和 session 字段 | 映射到 `ToolEvent`，其余核心代码不变 |
| `gateway_stop` | 正确的退出事件名称 | 保证调用 `core.flush()` |
| 心跳 | 是否有原生 cron 注册 API 可替代内置 `setInterval` | 每 5 分钟运行 `core.heartbeat()`，再 flush |
| `registerCommand` | `/mood` 命令定义和返回形状 | 绑定 `core.command()`；不得把解析逻辑复制进入口 |

只读排查命令（路径按你的安装方式调整）：

```bash
openclaw --version
openclaw plugins inspect affect-core --runtime --json

# 在你的 openclaw 安装目录里查钩子名，例如全局 npm 安装：
grep -R -n -E 'before_agent|before_prompt|after_tool_call|registerCommand' \
  "$(npm root -g)/openclaw/dist/plugin-sdk" --include='*.d.ts'
```

## 3. 构建与安装策略

`tsconfig.json` 为 `noEmit`（审查安全默认），发布编译使用 `tsconfig.build.json` 输出到 `dist/`：

```bash
pnpm run build
```

`src/openclaw-sdk-shim.d.ts` 只是让内核可以脱离网关编译的最小声明，**不是生产 SDK**。真正部署前把它替换为你所用版本的真实 `openclaw/plugin-sdk` 依赖。

推荐顺序：复制代码到临时目录 → 安装与服务器版本匹配的依赖 → 编译 → 执行 `openclaw plugins inspect --runtime` → 确认 typed hooks 与命令 → 最后才移动到扩展根目录（默认 `~/.openclaw/extensions/`）并在配置中显式启用。

## 4. 运行时配置原则

插件清单的 `enabled` 默认值为 `false`。初次启用时保持 L1 与主动消息均关闭：先验证 L0 的 `praise`、`blame`、`achieve` 三类事件和前置注入，再逐步打开关系层、心跳、L1 和副语言能力。

最小配置：

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

`proactive.tz` 默认为 `UTC`。安静时段和睡眠窗口要按本地时间生效，就把它设成自己的 IANA 时区。

## 5. 上线后验收

在真实消息流中验证：表达层异常时回复仍正常；工具失败两次后只影响语气、不降低工具调用；`/mood reset` 归零 PAD 但保留 mood；状态文件损坏后以基线恢复；频繁夸奖不能把 affection 推过 `0.85`；陌生用户不出现档位 2 或 3 的显性情绪自陈。

> 只要任意一项影响任务是否执行、工具能否调用、事实是否完整或安全判断是否生效，就立即关闭 `affect-core`，并把故障限定在适配层排查。
