# Affect Core 宠物养成版（v0.3）

仓库：https://github.com/JamesHu6657/affect-core  

**还没部署到 OpenClaw 现网。** 现网仍是 v0.2。

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
