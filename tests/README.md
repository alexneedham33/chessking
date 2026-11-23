# Chess coach regression tests

## Scope

This suite separates two different questions:

1. **Is the computed chess evidence correct?** Run `node --test tests/coach-regression.mjs`. These deterministic tests read the actual chess-analysis functions from `index.html`, with no API charges or AWS access. GitHub Actions runs them on relevant pushes and pull requests.
2. **Is the AI's lesson useful?** Use `tests/coach-review-cases.json` as a frozen review checklist. It records expected lessons and previously observed failure modes. The scores deliberately start blank. They are **not** automatic OpenAI-model test results.

## How to run

```bash
cd ~/chessking
git pull origin main
node --test tests/coach-regression.mjs
```

Look for zero failures and a test count of 36. The CI workflow is **Chess coach regression** under GitHub Actions.

## Reviewing model explanations fairly

For a reproducible qualitative comparison, fix (a) the exact board/FEN and move, (b) the engine depth and analysis output, (c) the coaching model and prompt version, and (d) the input payload. Black's Quick Play replies vary, so simply repeating *White* moves does not reliably reproduce the same position.

The 24 review cases include historical examples, selected alternative-move failures, tactical warnings, and structural issues. Cases with `referenceSequence: "main-line"` supply the recorded move order. Cases marked as separate scenarios are **review prompts**, not fully captured engine fixtures; they require an exact FEN and payload to be collected before an apples-to-apples model comparison.

For each exact position, save the input payload and the output, then score four dimensions from 0 to 5: board accuracy, tactical validity, teaching usefulness, and clarity. Record every invented move, unverified material gain, unsupported defence, or false centre classification as a hard factual failure even if the response is otherwise fluent.

Compare the aggregate score and **hard-failure count**, not just the most impressive individual answer. Only promote an AI or prompt change after it has been checked against the same frozen inputs.

## What is deliberately *not* asserted

These tests do **not** automatically call GPT-5.4 mini, validate Stockfish's evaluation, or certify every tactical claim. The structural tests are unit tests of geometry and before/after facts. The review checklist provides a repeatable baseline for later live or recorded-output evaluation. A pass means these particular invariants hold, not that every model explanation is correct.
