# Self-review follow-up (2026-08-14)

The 12 findings below were filed before the fix pass. Status after the pass:

- Issues 1–8 (bugs): addressed in `src/` + covered by new `test/core.test.ts` cases.
- Issues 9–12 (suggestions): tests added; daily cap is now hard; `/mood` shows `n/12`; contact no longer spends the affection budget; tool/message paths flush.

`npm test` is 23/23.

---

## Summary

This local pet-cultivation layer is a coherent v3 overlay on yesterday's affect-core: daily caps, streak, stage thresholds, and `/mood` card math match DESIGN.md on the happy path. `npm test` (17/17) and `npm run simulate` both pass, and the 30-day diary hits 眼熟 / 熟悉 / 亲近 on days 9 / 19 / 30 with a spam-day familiarity bump of +0.025. The package is not deploy-ready: heartbeat computes a neglect penalty and then throws it away, familiarity still fades on a weekly timer, `/mood reset` does not change the displayed 神色, L0's catch-all plus `l0?.tag ?? "contact"` treats criticism and empty payloads as companionship, and the prompt hook drops `ctx.senderId` so director notes can stay stuck on 陌生 after a live swap.

## Issues

### Issue 1 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\core.ts:186
- Description: Heartbeat calls `applyNeglectLedger` and, when the returned delta has `affection`/`trust`, only writes `neglect.care` (streak zero, `lastNeglectDay`). It never calls `bonds.update` with `neglect.bond`. DESIGN.md says a missed civil day slowly lowers affection and slightly lowers trust; those numbers are dead. `npm run simulate` cannot catch this: the "第7天 断联" heartbeat sees `gap === 1` (last care was yesterday), so neglect does not even run; streak only resets on day 8 inside `applyCareLedger`. Affection on day 7 stays 0.056.
- Suggestion: After computing `neglect`, apply `neglect.bond` to every known bond (or the last-seen owner) via `bonds.update`, then persist. Add a core-level test that advances two civil days, runs `heartbeat`, and asserts affection/trust fell while familiarity did not.
- Status: open

### Issue 2 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\bonds.ts:22
- Description: `fadeBond` still subtracts `0.008` familiarity per week (capped at 0.2). Heartbeat calls `fadeAll` (`core.ts:185`). `bonds.read` also fades and marks dirty, so `/mood` alone can lower familiarity. `applyBondDelta` correctly refuses negative familiarity, and `applyNeglectLedger` does not touch it — but the weekly fade is a second neglect path that violates "familiarity never decreases; affection/trust only" and DESIGN.md "熟悉度几乎不动".
- Suggestion: Stop fading familiarity (keep lastSeenAt bookkeeping). If a tiny fade is still wanted, apply it only from `fadeAll` on multi-day gaps, never from `read`, and never below a floor that would drop a displayed stage.
- Status: open

### Issue 3 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\care.ts:171
- Description: When neglect *does* fire, `missed = min(3, gap - 1)` is re-applied on every later civil day (`lastNeglectDay === day` only blocks same-day repeats). Gone Mon–Fri with a heartbeat each morning: day Wed −0.012, Thu −0.024, Fri −0.036 — total −0.072 affection / −0.06 trust for three missed days, not one increment per missed day. The isolated test only proves the same-day gate. If Issue 1 is fixed without fixing this, a week offline will flatten affection/trust, contradicting "冷落会瘪，不会死".
- Suggestion: Charge only the new missed day since `lastNeglectDay` (or since `lastCareDay` on the first hit), e.g. `min(1, newlyMissed)`, and keep a running `neglectedThrough` date so a 10-day absence cannot be billed three times over.
- Status: open

### Issue 4 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\core.ts:106
- Description: `applyCareLedger(..., l0?.tag ?? "contact")` turns every L0 miss into a full 陪伴 event: streak, daily interactions, +familiarity, +affection, and `applySatisfiedDrives(..., ["contact"])`. `appraiseL0` correctly returns null for empty text and for strings shorter than 2 characters (DESIGN.md: 普通说话 ≥2 字). `messageText` in `index.ts:62` also yields `""` when `content` is a parts array (sticker/image/media-only). Those payloads still count as "今日已照顾" and keep lonely from firing.
- Suggestion: If `!l0`, do not call `applyCareLedger` and do not satisfy the contact drive. Only treat `text.trim().length >= 2` (or an explicit L0 tag) as a care day.
- Status: open

### Issue 5 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\appraise-l1.ts:29
- Description: `needsL1` returns false whenever L0 hit. L0's last branch (`appraise-l0.ts:38`) is `text.length >= 2 → contact`. Every real sentence therefore hits L0, so the L1 path in `core.ts:115-128` is unreachable. Phrases DESIGN.md lists as 指责 / L1 blame (`失望`, `批评`, `抱歉`, `道别`, `承诺`) are not in the L0 blame/interrupt lists, so they become 陪伴 (+familiarity/+affection) and never apply the blame/distance recipe. Enabling `l1.enabled` later will not fix this.
- Suggestion: Either drop the contact catch-all until after L1, or run L1 (or a wider L0 lexicon) *before* choosing a care tag. Do not write a positive contact delta for 失望/批评/抱歉. `needsL1` should not be gated on `!l0Hit` if L0 contact is the default.
- Status: open

### Issue 6 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\dynamics.ts:225
- Description: `/mood reset` (`commands.ts:23`) and `onSessionReset` call `resetPadKeepMood`, which restores PAD and clears habituation but leaves `lastEvents`. `emotionalLabel` (`derive.ts:30`) prefers a <4h `lastEvents[0]` over PAD, then `derive` (`derive.ts:59`) floors intensity to 1 whenever the label is not 平和. After reset the command text says "脸上的神色已归零", but the next `/mood` and the next director note still show 愉悦/安定/受挫 at intensity ≥ 1. That is the same "stuck label" failure mode this package was meant to replace, just inverted: the event name now outlives the PAD reset.
- Suggestion: On reset, clear `lastEvents` (or mark them stale). Keep care/bonds/journal. Add a test: praise → reset → `emotionalLabel` is 平和 and intensity is 0 at baseline PAD.
- Status: open

### Issue 7 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\index.ts:143
- Description: `before_prompt_build` / `before_agent_start` pass only the first hook argument through `senderId(event)`. OpenClaw documents that hook as prompt + session messages; `ctx.senderId` lives on the second argument (and on `ctx.channelContext.sender.id`). `beforeAgentReply` then does `bonds.read(userId ?? "anonymous")` (`core.ts:167`). Anonymous familiarity is 0 → stage 陌生, intensity cap 1, formal address. `/mood` via `registerCommand` may still show 亲近 for the real sender. After a live swap the cultivation numbers can be real while the only thing the model sees is 陌生. `message_received` itself does expose top-level `senderId`, so bonds can grow and the panel can be honest at the same time the prompt is not.
- Suggestion: `async (event, ctx) => senderId(event) ?? asId(ctx?.senderId) ?? asId(ctx?.channelContext?.sender)`. Fall back to the most recently seen inbound sender for that `sessionKey` if still missing. Add a wiring test that `beforeAgentReply("6821072295")` and `beforeAgentReply(undefined)` are not treated as equivalent once a bond exists.
- Status: open

### Issue 8 -- Severity: bug
- File: D:\FM_dev\workspace\affect-core-pet\src\core.ts:146
- Description: A long successful tool (`durationMs >= 10000`) is tagged `achieve`, which is a STREAK_TAG and writes lastCareDay / +familiarity / +affection / +trust. `after_tool_call` (`index.ts:131`) never reads `ctx.requester.senderId`; credit goes to process-global `lastUserId`. OpenClaw cron/heartbeat turns run tools. A 10s nightly job will: keep the streak alive with no human utterance, feed the last speaker's bond, and refresh `lastInteractionAt` (also done for non-achieve tools at `core.ts:155`), which suppresses lonely. DESIGN.md's "每天都要露面 / 任意一次有效对话" is then false.
- Suggestion: Credit achieve only when the tool turn has a real inbound sender (pass `ctx.requester.senderId` / session owner into `onToolResult`). Do not let `achieve` increment streak unless that sender already has a human care event today. Do not treat unattributed tool ticks as `lastInteractionAt` for lonely.
- Status: open

### Issue 9 -- Severity: suggestion
- File: D:\FM_dev\workspace\affect-core-pet\test\care.test.ts:65
- Description: The suite that just passed does not exercise the bugs above. Neglect is unit-tested only on the ledger return value, not on `heartbeat` → `bonds`. There is no test that empty/1-char/media messages are ignored, that `失望` is not contact, that `/mood reset` changes the label, that v2 `state.json` without `care` seeds `lastStage` from existing `bonds.json`, or that two users do not share one daily cap. `simulate-month.ts` never calls heartbeat with `gap >= 2` and never checks an affection drop, so its diary can look green while neglect is a no-op.
- Suggestion: Add core tests for the cases in Issues 1–8 before any copy to `/root/.openclaw`. Keep simulate, but heartbeat on the morning *after* the skipped day with no message, and assert affection declined.
- Status: open

### Issue 10 -- Severity: suggestion
- File: D:\FM_dev\workspace\affect-core-pet\src\store.ts:72
- Description: v2→v3 sanitize always writes `version: 3` and `seedCare(...)` for a missing `care` object. That part is fine and will not wipe PAD/drives/journal. `lastStage` is forced to 陌生 even when `bonds.json` already has familiarity ≥ 0.15 from the old +0.01/message rule. The first inbound after a live swap will `noteStage` jump 陌生→眼熟/熟悉/亲近/羁绊 in one shot, journal "升到 …", and flash 雀跃. Care is also a single agent-wide ledger (`state.json`), not keyed by sender, so two senders share one streak and one 0.022/0.016 cap.
- Suggestion: On first v3 seed, set `lastStage = stageOf(max familiarity among bonds)` and do not emit a promotion impulse. If this stays single-owner, document that. If it might serve a group chat, move `care.today` / streak under each bond id.
- Status: open

### Issue 11 -- Severity: suggestion
- File: D:\FM_dev\workspace\affect-core-pet\src\care.ts:107
- Description: Daily "cap" is soft: once `today.familiarity` ≥ 0.022, `takePositive` still returns `want * 0.05`. Combined with interaction scale that is why spam day lands at +0.025, matching DESIGN.md's diary, but it is not a hard cap. Separately, 8× contact already spends the whole 0.016 affection cap (`8 * 0.002`), so a later 谢谢 that day is almost only the 5% leak — the opposite of "质量比数量重要". The `/mood` line `今日养成 ${min(interactions, 8)}/8` (`derive.ts:93`) also freezes at 8/8 after the 9th event, so the card cannot show that the user is in the 40%/10% band.
- Suggestion: Make the numeric cap hard (return 0 when `room === 0`) if that is the contract, or document the 5% leak. Count quality tags against a separate budget, or apply contact affection after praise/achieve. Show `interactions/12` or remaining room on the card.
- Status: open

### Issue 12 -- Severity: suggestion
- File: D:\FM_dev\workspace\affect-core-pet\src\core.ts:133
- Description: `onToolResult` mutates store and bonds but never `flush`es. `onMessage` also returns without flush when L1 is "needed" but the budget denies or the adapter returns null (`core.ts:120-123`). A crash before the 5-minute heartbeat drops achieve/care writes. Same shape as yesterday's plugin; more painful now that those writes are the cultivation ledger.
- Suggestion: `await this.flush()` at the end of `onToolResult` and on the L1 early-return paths after the L0/care mutate.
- Status: open
