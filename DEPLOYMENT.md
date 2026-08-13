# affect-core 部署前检查清单

> 本清单故意将“复制到服务器并启用插件”放在最后。当前交付是本地审查包，不是已部署插件。

## 1. 审查通过条件

在本地目录中完成以下检查，并保持无改动通过。

```powershell
cd D:\FM_dev\affect-core
pnpm run check
```

通过标准为 TypeScript 检查成功，且 `test/invariants.test.ts` 的 27 项测试全部通过。测试覆盖状态边界、心境直接耦合、时钟回拨、长停机、非法时间常数、L1 降级、配额、并发、关系饱和、陌生用户强度、表达硬约束、寂寞时钟、驱力满足、`/mood` 出口和 energy 包络。

## 2. 在目标服务器只读核对 SDK

目标环境此前识别为 OpenClaw `2026.7.1-2`，全局扩展目录为 `/root/.openclaw/extensions`。部署前必须在该服务器上读取实际声明，核对 `src/index.ts` 中隔离的候选桥接。

| 本地候选桥接 | 必须核对的问题 | 处理规则 |
|---|---|---|
| `message_received` | 真实入站事件名；文本、用户 ID、消息 ID 字段 | 仅修改 `index.ts` 的事件名和读取字段 |
| `before_agent_start` | 是否为正确前置代理钩子；系统提示追加字段是 `systemAppend`、`appendSystemPrompt` 还是其他 | 仅修改返回对象字段；失败必须返回空对象 |
| `after_tool_call` | 工具名、耗时、错误和 session 字段 | 映射到 `ToolEvent`，其余核心代码不变 |
| `gateway_shutdown` | 正确的退出事件名称 | 保证调用 `core.flush()` |
| `registerCron` | 实际 cron 注册 API 与表达式格式 | 每 5 分钟运行 `core.heartbeat()`，再 flush |
| `registerCommand` | `/mood` 命令定义和返回形状 | 绑定 `core.command()`；不得把解析逻辑复制进入口 |

建议命令如下，仅作只读 SDK 排查用途：

```bash
sudo openclaw --version
sudo openclaw plugins inspect affect-core --runtime --json
sudo grep -R -n -E 'before_agent|after_tool_call|registerCommand|registerCron' \
  /usr/lib/node_modules/openclaw/dist/plugin-sdk --include='*.d.ts'
```

## 3. 构建与安装策略

当前 `tsconfig.json` 设置为 `noEmit`，目的是最大化本地审查安全性。真正部署前，建议创建一个独立的发布配置（例如 `tsconfig.build.json`）输出到 `dist/`，并替换 `src/openclaw-sdk-shim.d.ts` 为目标服务器对应版本的实际 `openclaw/plugin-sdk` 依赖。不要把 shim 当成生产 SDK。

应采用以下顺序：先复制代码到临时目录、安装与服务器版本匹配的开发依赖、编译、执行 `openclaw plugins inspect --runtime`、确认 typed hooks 和 tools，最后才移动到扩展根目录并在配置中显式启用。

## 4. 运行时配置原则

插件清单的 `enabled` 默认值为 `false`。初次启用时保持 L1 和主动消息均关闭；先验证 L0 的 `praise`、`blame`、`achieve` 三类事件和前置回复注入，再逐步打开关系层、cron、L1 和副语言能力。

推荐的最小配置为：

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
          "proactive": { "enabled": false, "quietHours": ["23:30", "08:00"], "tz": "Asia/Singapore" }
        }
      }
    }
  }
}
```

## 5. 上线后验收

上线后要在真实消息流中验证以下行为：表达层异常时回复仍正常；工具失败两次后只影响语气、不降低工具调用；`/mood reset` 归零 PAD 但保留 mood；状态文件损坏后以基线恢复；频繁夸奖不能把 affection 推过 `0.85`；陌生用户不出现档位 2 或 3 的显性情绪自陈。

> 只要任意一项影响任务是否执行、工具能否调用、事实是否完整或安全判断是否生效，就应立即关闭 `affect-core`，并将故障限定在适配层排查。
