# Affect Core 宠物养成版（v0.3.3）

仓库：https://github.com/JamesHu6657/affect-core  

**还没部署到 OpenClaw 现网。** 现网仍是 v0.2。

## 安装时必须加这一段

外部插件的 `before_prompt_build` 默认会被 OpenClaw **静默忽略**（只打 warning，不抛错）。不写下面这段，PAD / `/mood` 会动，模型语气完全不变：

```json
{
  "plugins": {
    "allow": ["affect-core"],
    "entries": {
      "affect-core": {
        "enabled": true,
        "hooks": {
          "allowConversationAccess": true
        },
        "config": {
          "enabled": true,
          "ownerIds": ["YOUR_TELEGRAM_USER_ID"],
          "l1": { "enabled": false },
          "proactive": { "enabled": false }
        }
      }
    }
  }
}
```

启动日志里应看到 affect-core 提醒这条权限。若 gateway 出现 `typed hook "before_prompt_build" blocked`，就是没写 `allowConversationAccess`。

`/mood` 人人可查；`/mood off|on|reset` 只允许 `ownerIds`（或命令上下文里的 `senderIsOwner`）。`proactive` 只产出建议，**不会发消息**。

## 心跳看得到对话（v0.3.3）

OpenClaw 心跳是系统轮次：没有 sender；开了 `heartbeat.isolatedSession: true` 时还是全新会话，看不到聊天历史。之前插件在心跳里会落到进程内的 `lastUserId`（gateway 一重启就丢）甚至 `anonymous`，导演指令按「陌生人」写，也没有任何最近对话。

现在：

- 普通轮次（`before_prompt_build` / `agent_end`）把最近对话尾巴存进 `stateDir/recent.json`（仅 user/assistant 文本，去掉工具输出和本插件自己的注入，默认最多 8 条、每条 280 字、合计 1800 字，权限 0600）。
- 新增 `heartbeat_prompt_contribution`：心跳时注入「正确的人」的导演指令 + 最近对话节选。心跳本身就在同一会话时不重复注入历史；超过 `maxAgeHours`（默认 24）不注入。
- 发送者回退顺序：本轮 sender → 会话映射 → 进程内最近 sender → `recent.json` 里持久化的 sender → `ownerIds[0]`。
- `message_received` 现在从 hook ctx 读 `sessionKey` / `senderId`（之前只读 event，会话映射一直是空的）。
- 旧版 host 没有 `heartbeat_prompt_contribution` 时，`before_prompt_build` 在心跳轮次自己补上同样内容；新版 host 不会重复。

可选配置（`config` 内）：

```json
"heartbeatContext": { "enabled": true, "maxTurns": 8, "maxCharsPerTurn": 280, "maxTotalChars": 1800, "maxAgeHours": 24 }
```

`agent_end` 也需要 `allowConversationAccess`（上面那段已经包含）。

## 先看什么

1. [DESIGN.md](./DESIGN.md) — 节奏、日上限、阶段、刻意没做的事
2. `src/care.ts` — 养成账本（日结、连陪、冷落）
3. `src/derive.ts` + `src/commands.ts` — `/mood` 宠物面板
4. `src/core.ts` — 怎么接到对话 / 工具 / 心跳上

## 怎么跑

需要 Node 22+。

```powershell
cd D:\FM_dev\affect-core
npm test
npm run simulate
```

`simulate` 会打 30 天日记：第 7 天断联、第 13 天刷 40 句。审查时看：

- 刷屏那天熟悉度不该明显跳高
- 断联后连陪归 1
- 认真养大约第 9 天进「眼熟」，第 19 天「熟悉」，满月「亲近」，还到不了「羁绊」

## 审查时请拍板的点

- 日上限 0.022 / 0.016 是否太慢或太快
- 阶段门槛（0.15 / 0.35 / 0.60 / 0.82）
- `/mood reset` 只洗脸、不拆养成 — 要不要改
- 满意后再说部署；不要直接拷进 `/root/.openclaw`

L1 默认关，是实验性关键词占位，不是大模型。养成账本按 `userId` 分开：甲说话保不住乙的连陪。`npm test` 现含 v0.2 数值安全网（52 项）。
