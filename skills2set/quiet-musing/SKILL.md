---
name: quiet-musing
description: "复杂问题推理框架。遇到多步骤、高不确定性、需要权衡取舍的任务时启用。触发场景：分析复杂问题、做决策、权衡方案、调试疑难 bug、架构设计、策略规划、想清楚再做、帮我分析一下、这个问题比较复杂、深度思考。不要在简单问答、闲聊、单步操作时启用。 Deep reasoning framework for complex tasks. Activates for multi-step problems, high uncertainty, or trade-off decisions. Triggers: analyze complex problem, make decision, weigh options, debug hard bug, architecture design, strategy planning, think it through, help me analyze, this is complicated, deep thinking. Do NOT activate for simple Q&A, casual chat, or single-step tasks. "
---

# Deep Reasoning Protocol

A thinking and execution framework for complex problems. Complements MOOD: MOOD captures intuition and emotion; this protocol governs structured reasoning.

## When to Activate

Activate when any of the following is true:

- The problem has **multiple reasonable approaches** requiring trade-off decisions
- Requirements are **vague or implicit**, cannot proceed directly
- The decision involves **architecture, strategy, or design** concerns
- Debugging requires **systematic investigation** rather than an obvious fix
- The task **affects multiple modules** or has cascading effects
- The user explicitly asks for in-depth analysis

**Do NOT activate** for: typo fixes, factual Q&A, single-step operations. When in doubt, don't activate — applying a complex process to a simple problem is wasteful.

---

## Phase 1: Understand

Before acting, confirm you actually understand the problem.

1. **Restate the problem in your own words**: Not copying the user's words, but rephrasing with your understanding. If you can't restate it, you don't understand it yet.
2. **Separate known from unknown**: What information is certain? What are you guessing? What needs to be looked up first?
3. **Find the real problem**: What the user asks and what the user needs are often not the same thing. "Add a button" may mean "this workflow is too long."
4. **Flag uncertainty**: Explicitly state what you're unsure about. Don't pretend to know everything.

If the problem itself is unclear at this point, ask the user first. Don't proceed with a fuzzy understanding.

## Phase 2: Decompose

Break the big problem into independently handleable pieces.

1. **Identify sub-problems**: A big problem typically consists of 2–5 sub-problems. Find them.
2. **Clarify dependencies**: Which can run in parallel? Which must be sequential? Map it out.
3. **Build a todo list with the todo tool**: Each item should be sized so it can be done in one pass and verified afterward. Don't split too fine ("open the file" is not a todo) or too coarse ("fix all bugs" is not a todo).

```
Examples:
✓ Good granularity: "Fix the null guard in engine.js", "Add a toast for archive failure"
✗ Too fine: "Open engine.js", "Find line 1302", "Write the if statement"
✗ Too coarse: "Refactor the entire frontend"
```

## Phase 3: Multi-Path Thinking

Don't rush into the first approach you see.

1. **Think of at least two paths**: Even if the first approach looks right, spend 30 seconds considering alternatives.
2. **Explicitly write out trade-offs**: Benefits, costs, and risks of each path. One or two sentences each — no essays needed.
3. **Give reasons when choosing**: Not "I pick A", but "Choosing A because XYZ; B would also work but XYZ."
4. **Stay overturnable**: If you realize halfway through that you're on the wrong path, have the courage to switch. Don't fall for sunk cost.

If all paths lead to the same answer, no need to force a second one. Multi-path thinking is about avoiding blind spots, not performing.

## Phase 4: Execute

Work through the todo list. Keep the rhythm.

1. **Single-threaded**: Do one thing at a time. Mark it complete before starting the next.
2. **Adjust dynamically**: Discover a new issue during execution? Add it to the todo. Find an item is no longer needed? Remove it. The list is alive.
3. **Every step is verifiable**: After completing a step, confirm it's correct (run it, look at it, test it) before moving on.
4. **Don't force through blockers**: If a path doesn't work, stop and think about why, instead of trying the same thing differently.

## Phase 5: Verify

Done doesn't mean correct.

- [ ] Go back to Phase 1's problem restatement — does the actual result match?
- [ ] Are there missed edge cases?
- [ ] Did the changes introduce new problems?
- [ ] Is what the user actually needed satisfied?

---

## Reasoning Posture

Underlying principles throughout the process:

**Be a detective, not a judge.** A detective follows leads and allows themselves to change their mind. A judge must reach a verdict early. Before Phase 3 ends, you are a detective.

**Errors are clues.** If you discover you were wrong during reasoning, don't silently correct — say it out loud: "I assumed X was true, but looking at the code it isn't, so I'm switching direction." The information exposed by an error is often more valuable than correct reasoning.

**Depth matches complexity.** Think shallowly about simple problems, deeply about complex ones. Not every problem deserves all 5 Phases. Changing a CSS color doesn't need "multi-path thinking." Adapt; don't be dogmatic.

**Stay synced with the user.** Phase 1 and Phase 3 are good checkpoints for alignment. When uncertain, ask. When there are multiple paths, let the user choose. Don't go heads-down and finish only to find the direction was wrong.
