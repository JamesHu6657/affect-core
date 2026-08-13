# 参与

改动力学的 PR 请带一条改动前会失败的测试。这个项目的正确性没法靠「感觉像不像有情绪」判断，只能靠不变量。

## 环境

Node 22.6+ 和 pnpm。

```bash
pnpm install
pnpm run check      # 类型检查 + 测试
pnpm run test:watch
```

## 约定

- `dynamics.ts` 保持纯函数、零 I/O。要用时间就把 `now` 当参数传进去
- OpenClaw SDK 名称只出现在 `src/index.ts`，内核不 import 任何 OpenClaw 类型。签名猜错时影响面要限制在一个文件里
- 注入片段里不要出现裸数值，给模型演出指令而不是状态转储
- 每条失败路径都 fail-open
- 不放宽 TypeScript 严格选项，`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes` 都是开着的
- 不做无关的格式化和重命名

调参的话：先定 baseline，再定 τ，最后才碰事件增量表。另外 τ 是时间常数不是半衰期（半衰期 = τ·ln2）。

## PR

`pnpm run check` 全绿，行为改动有对应断言。如果动了不变量的语义，在描述里说清原本保护的是什么。用削弱不变量的方式修 bug 是回归。

动了 `src/index.ts` 的钩子名或字段的话，说明一下你是在哪个 OpenClaw 版本上核对的。

## issue

情感行为类的问题请附上配置片段（去掉密钥）、`/mood` 输出和触发的事件序列。「它感觉不对」很难查，「连点五次夸奖后 mood 没动」一眼就能定位。
