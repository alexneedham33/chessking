# Opening Lab chess-coach regression testing

There are two complementary suites, including a targeted tactical stress pack.

## 1. Deterministic chess facts — free, automatic

```bash
node --test tests/coach-regression.mjs
```

60 tests verify geometry, absolute pins, central-file status, doubled/isolated pawns, bishop-pair changes, verified bishop routes, immediate legal recaptures, consecutive same-square exchanges and Lambda response checks. GitHub Actions runs this automatically when relevant files change.

## 2. AI explanation regression — replayable positions

```bash
node tests/coach-ai-regression.mjs
```

This free **offline mode** replays fixed legal move sequences using the **production chess rules**, generates the same board/tactical/strategic evidence used by Opening Lab, and writes a JSON report to `tests/reports/`. It does **not** call GPT and does not claim AI explanations have passed.

There are **26 runnable review cases**: 22 historical checks (some repeat the same position with different grading objectives) plus four independent curated tactical FENs. Two incomplete historical cases are still skipped. The tactical cases are checked against the production move generator and require legal moves, exact FEN round trips and board-derived facts. Their evaluation is intentionally unknown without a frozen engine analysis. The reconstruction of the central-pawn line is an illustrative fixed scenario, not a claim about a previously played Stockfish game.

### Run real coaching requests

Start the usual local proxy in terminal 1:

```bash
cd ~/chessking
git pull origin main
node local-server.mjs
```

Then, in terminal 2:

```bash
cd ~/chessking
node tests/coach-ai-regression.mjs --live --limit 6
```

`--live` explicitly authorizes up to the specified number of requests to **your currently deployed AWS Lambda** through `http://127.0.0.1:8000/api/coach/move`. These calls can incur OpenAI API charges, including the Lambda's one-pass repair request. Start with 6, then use `--limit 15` to cover all complete positions. Never paste or hardcode an API key; the existing local proxy handles requests.

The script saves model messages, input fingerprints, incomplete/skipped cases, basic factual and length warnings, and four **blank** human-review dimensions. It exits nonzero on request errors.

**Important:** The replay payloads contain real, deterministic board facts, but deliberately have **no fabricated Stockfish evaluations or principal variations**. As a result, they test the coach's ability to use board evidence and explain ordinary moves, but **do not test model claims about best alternatives**. Engine-specific and high-stakes tactical scenarios need separately frozen, genuine Stockfish payloads.

### Tactical stress pack (four paid AI requests)

The separate tactical group covers a knight fork of king and queen, a revealed bishop attack after a knight moves, an absolute rook pin, and a bishop capture that can be met by a king capture (a **possible** sacrifice, not an asserted sound sacrifice).

After deploying the latest Lambda and starting `node local-server.mjs` in terminal 1, run in terminal 2:

```bash
cd ~/chessking
git pull origin main
node tests/coach-ai-regression.mjs --live --group tactical --limit 4
```

Offline: `node tests/coach-ai-regression.mjs --group tactical` checks only these four positions, with **no paid calls**. The normal default `--limit` is 6 and the supported maximum is 40. Use `--group historical` to exclude tactical cases.

**Scope:** these four situations are constructed educational positions, not a claim about a recorded game or Stockfish's best continuation. The harness does not fabricate engine scores. The live review checks whether GPT describes the correct fork targets, newly exposed sliding-piece attack, absolute pin, and sacrifice uncertainty. Automatic success indicates validated geometry, *not* that the language-model explanation is tactically sound.

### Compare before / after

Run a baseline first and note the saved file path, for example `tests/reports/coach-live-2026-11-23T23-59-00-000Z.json`. After an update, run:

```bash
node tests/coach-ai-regression.mjs --live --limit 6 --baseline tests/reports/YOUR-BASELINE.json
```

The new report includes a per-case `samePosition` and `sameEvidence` check and the old and new warning counts. Compare only cases whose positions and evidence both match. Model responses are nondeterministic, so run more than one trial when assessing subtle changes.

### Run a specific case

```bash
node tests/coach-ai-regression.mjs --live --case 13-white-b-pawn-takes-c3
```

The human quality rubric in `tests/coach-review-cases.json` contains 28 named checks with expected lessons and historical failure modes. Review the full coach text for **correctness, tactical insight, teaching value, and conciseness**, each 0–5, and mark factual hallucinations even if the automated warnings miss them.

Automated checks flag only a limited subset of possible issues (e.g., inaccurate claims about direct pawn defence, unsupported alternatives and response lengths). **Zero warnings does not mean a response is correct.**

### CI

The GitHub Actions workflow **Chess coach regression** runs the 60 mechanical and validator tests and the offline AI-fixture replay on pushes and PRs affecting the test code. It makes no paid API requests. Generated reports are ignored by Git.

The goal is reproducible evidence, not a misleading overall “AI accuracy score.” Once full position+engine payloads exist, we can expand the fixed set to cover every case and measure true prompt/model changes.

## Exchange and recapture regression (November 2026)

The coach now attaches `tacticalFacts.exchangeEvidence`, derived from the exact legal move generator. It includes the captured piece, legal opponent captures of the just-moved piece, legal next-ply recaptures of those attackers, and `completedExchange` when the previous move captured a piece on the same square and this move recaptures it.

The replay harness automatically checks the historical positions: White's a3 allows a bishop capture answered by the b-pawn, White's e4 allows knight/pawn captures that can be recaptured by the c3 knight, Black's bishop capture on c3 permits a b-pawn recapture, and White's bxc3 completes an equal-value bishop-for-knight exchange. The Lambda text validator also flags ungrounded 'wins a piece' and 'undefended' claims in these supported cases.

**Important:** legal recapture options are not forcing lines or proof of a favourable trade. Stockfish evidence is still necessary to claim one side gains from the complete sequence. In previous-position capture cases where reliable history is missing, the runner must not infer an exchange.
