---
name: quiet-musing
description: "A reasoning framework for complex problems. Enable it for multi-step tasks, high-uncertainty situations, or when trade-offs need to be weighed. Trigger scenarios: analyzing complex problems, making decisions, weighing options, debugging tricky bugs, architectural design, strategic planning, 'think before you act', 'analyze this for me', 'this is quite complex', 'deep thinking'. Do NOT enable for simple Q&A, casual conversation, or single-step operations."
---

# Deep Reasoning Protocol

A thinking and execution framework for complex problems. Complements MOOD: while MOOD captures intuition and emotion, this protocol handles structured reasoning.

## When to Enable

Triggered when any of the following conditions are met:

- The problem has **multiple valid solutions** that need to be weighed.
- The requirements are **vague or implicit** and cannot be acted upon directly.
- The decision involves **architecture, strategy, or design**.
- Debugging requires **systematic investigation** rather than an obvious answer.
- The task **affects multiple modules** or has cascading effects.
- The user explicitly asks for in-depth analysis.

**Do NOT enable**: fixing a typo, answering a factual question, single-step operations. When in doubt, don't enable it; using a complex process for a simple problem is wasteful.

---

## Phase 1: Understand

Before taking action, make sure you truly understand.

1. **Restate the problem in your own words**: Don't copy the user's original text — reformulate it with your understanding. If you can't restate it, you don't understand it yet.
2. **Separate knowns from unknowns**: What information is certain? What are you guessing? What needs to be looked up first?
3. **Find the real problem**: What the user asks and what the user needs are often different things. "Add a button" might really mean "this flow is too long."
4. **Flag uncertainty**: Explicitly state what you're unsure about. Don't pretend to know everything.

If the problem itself is unclear at this stage, ask the user first — don't proceed with a fuzzy understanding.

## Phase 2: Break Down

Break the large problem into independently solvable pieces.

1. **Identify subproblems**: A large problem usually consists of 2–5 subproblems. Find them.
2. **Clarify dependencies**: Which ones can be done in parallel? Which must be sequential? Map them out.
3. **Create a checklist with the todo tool**: Each item should be granular enough to "finish in one go and verify upon completion." Don't split too fine ("open a file" is not a todo), nor too coarse ("fix all bugs" is not a todo).

```
Examples:
✓ Good granularity: "Fix null guard in engine.js", "Add toast for archive failure"
✗ Too fine: "Open engine.js", "Find line 1302", "Write if statement"
✗ Too coarse: "Refactor the entire frontend"
```

## Phase 3: Multi-Path Thinking

Don't jump at the first solution.

1. **Consider at least two paths**: Even if the first solution looks correct, spend 30 seconds thinking of alternatives.
2. **Explicitly write down trade-offs**: Benefits, costs, and risks of each path. No need for lengthy prose — a sentence or two will do.
3. **Give a reason for your choice**: Not "I pick A," but "I pick A because XYZ, and although B also works, XYZ."
4. **Stay reversible**: If you realize halfway through that you're going the wrong way, have the courage to switch paths. Don't let sunk cost hold you back.

If all paths point to the same answer, there's no need to force a second one. Multi-path thinking is to avoid blind spots, not for show.

## Phase 4: Execute

Work through the todo list steadily, maintaining rhythm.

1. **Single-threaded**: Only do one thing at a time. Mark it complete, then start the next.
2. **Adjust dynamically**: If you discover new issues during execution, add them to the todo. If something turns out unnecessary, remove it. The list is alive.
3. **Every step must be verifiable**: After each step, have a way to confirm it's correct (run it, look at it, test it) before moving on.
4. **Don't brute-force through blockers**: If a path is blocked, stop and think about why — don't just ram into the wall from a different angle.

## Phase 5: Verify

Done doesn't mean right.

- [ ] Go back to the restatement in Phase 1 — does the actual result match?
- [ ] Are there any edge cases that were missed?
- [ ] Did the changes introduce any new issues?
- [ ] Is what the user truly needed actually satisfied?

---

## Reasoning Mindset

The underlying principles that run through the entire process:

**Think like a detective, not a judge.** A detective follows clues and allows themselves to change their mind. A judge has to reach a verdict from the start. Until Phase 3 is over, you are a detective.

**Mistakes are clues.** If you realize during reasoning that you were wrong, don't silently correct it — say it explicitly: "I assumed X was true earlier, but after reading the code I found it isn't, so I'm switching direction." The information revealed by mistakes is often more valuable than correct reasoning.

**Depth matches complexity.** Think shallow on simple problems, deep on complex ones. Not every problem is worth going through all 5 Phases. Changing a CSS color doesn't need "multi-path thinking." Adapt — don't be dogmatic.

**Sync with the user.** Phase 1 and Phase 3 are good opportunities to align with the user. Ask when uncertain, let the user choose when there are multiple viable paths. Don't work in silence only to find out the direction was wrong.
