# Opening Lab chess-coach regression testing

There are two complementary suites, including a targeted tactical stress pack.

## 1. Deterministic chess facts — free, automatic

```bash
node --test tests/coach-regression.mjs
```

64 tests verify geometry, absolute pins, central-file status, doubled/isolated pawns, bishop-pair changes, verified bishop routes, immediate legal recaptures, consecutive same-square exchanges and Lambda response checks. GitHub Actions runs this automatically when relevant files change.

## 2. AI explanation regression — replayable positions

```bash
node tests/coach-ai-regression.mjs
```

This free **offline mode** replays fixed legal move sequences using the **production chess rules**, generates the same board/tactical/strategic evidence used by Opening Lab, and writes a JSON report to `tests/reports/`. It does **not** call GPT and does not claim AI explanations have passed.

There are **32 runnable review cases**: 22 historical checks (some repeat the same position with different grading objectives), four curated geometric tactical FENs, two Stockfish-backed checkmate tests, and four real Lichess middlegame puzzle snapshots. Two incomplete historical cases are still skipped. The tactical cases are checked against the production move generator and require legal moves, exact FEN round trips and board-derived facts. Their evaluation is intentionally unknown without a frozen engine analysis. The reconstruction of the central-pawn line is an illustrative fixed scenario, not a claim about a previously played Stockfish game.

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

The human quality rubric in `tests/coach-review-cases.json` contains 34 named checks with expected lessons and historical failure modes. Review the full coach text for **correctness, tactical insight, teaching value, and conciseness**, each 0–5, and mark factual hallucinations even if the automated warnings miss them.

Automated checks flag only a limited subset of possible issues (e.g., inaccurate claims about direct pawn defence, unsupported alternatives and response lengths). **Zero warnings does not mean a response is correct.**

### CI

The GitHub Actions workflow **Chess coach regression** runs the 64 mechanical and validator tests, the offline AI-fixture replay, and six Stockfish 17.1 tactical scenarios (at depth 12) on pushes and PRs affecting the test code. It makes no paid API requests. Generated reports are ignored by Git.

The goal is reproducible evidence, not a misleading overall “AI accuracy score.” Once full position+engine payloads exist, we can expand the fixed set to cover every case and measure true prompt/model changes.

## Exchange and recapture regression (November 2026)

The coach now attaches `tacticalFacts.exchangeEvidence`, derived from the exact legal move generator. It includes the captured piece, legal opponent captures of the just-moved piece, legal next-ply recaptures of those attackers, and `completedExchange` when the previous move captured a piece on the same square and this move recaptures it.

The replay harness automatically checks the historical positions: White's a3 allows a bishop capture answered by the b-pawn, White's e4 allows knight/pawn captures that can be recaptured by the c3 knight, Black's bishop capture on c3 permits a b-pawn recapture, and White's bxc3 completes an equal-value bishop-for-knight exchange. The Lambda text validator also flags ungrounded 'wins a piece' and 'undefended' claims in these supported cases.

**Important:** legal recapture options are not forcing lines or proof of a favourable trade. Stockfish evidence is still necessary to claim one side gains from the complete sequence. In previous-position capture cases where reliable history is missing, the runner must not infer an exchange.

## Engine-grounded tactical reasoning (two evaluated scenarios)

This is **separate from the four simple geometric tactic fixtures**. The runner uses the checked-in Stockfish 17.1 lite JS/WASM via UCI from Node, evaluates the position **before and after the candidate move**, validates the engine's PV against the actual production chess rules, and records raw engine scores and legally checked mate continuations in `engineProvenance`. Unlike the earlier geometry-only tests, `engine`, `priorEngine`, and `moveAssessment` are backed by actual engine output. Engine scores are White-relative in the coach payload and explicitly signed from the side to move in the raw provenance.

- `29-blunder-allows-fools-mate`: after 1.f3 e5 2.g4??, Black has 2...Qh4#.
- `30-queen-sacrifice-smothered-mate`: a curated legal position with Qg8+ Rxg8 Nf7#, whose defender reply and mate are verified from actual legal moves. This is an illustrative forcing puzzle, not an attribution to a historical game.

Offline verification, without any AI requests:

```bash
node tests/coach-ai-regression.mjs --group engine --stockfish --depth 14
```

Live AI review, which makes **two paid Lambda/OpenAI requests** and requires the current `lambda-coach/index.mjs` deployed:

```bash
node tests/coach-ai-regression.mjs --live --group engine --stockfish --depth 14 --limit 2
```

The runner refuses to run the engine group without `--stockfish` and fails if Stockfish doesn't confirm the expected mate or supplies a non-matching PV. Mate scores and checked mate lines describe the specific board state; evaluating a real complicated sacrifice generally needs stronger depth and further validation. Do not claim all tactical variations are forced merely because one engine PV ends in mate: the test marks defender moves as forced only if they are the only legal replies.


## Checkmate mechanism / checking-ray evidence (November 24, 2026)

`tacticalFacts.checkLine` identifies the actual checking piece(s), attacked king, and every empty intervening square on a bishop, rook, or queen's checking ray. `tacticalFacts.opponentCheckingReplyEvidence` provides these facts for up to five **legal checking replies** after the coached move, including whether the reply gives checkmate. Verified engine test continuations additionally carry `verifiedCheckLines` (only actual checking moves).

The Fool's Mate regression validates that `...Qh4#` checks along **h4–g3–f2–e1**, not via h3. Lambda has a conservative guard against attributing this particular mate to h3 pawn-cover changes. This is a specific regression rule, not a general-purpose semantic proof checker. Four deterministic tests check the mistake is rejected, the correct diagonal is accepted, and unrelated pawn-cover remarks are not spuriously blocked.

After redeploying the updated `lambda-coach/index.mjs` to AWS, and pulling the latest main branch locally, re-test the case with:

```bash
node tests/coach-ai-regression.mjs --live --group engine --stockfish --depth 14 --case 29-blunder-allows-fools-mate
```

The validation runs both offline and against live responses. The API Lambda has to be **deployed separately** from GitHub changes. If the local proxy is already running, stop/restart it after pulling.

## Real middlegame tactics from Lichess puzzles (four evaluated scenarios)

The new `--group middlegame` is based on **four publicly accessible Lichess puzzle records**. Each fixture preserves the source FEN **before the opponent's setup move** and the source UCI puzzle line. The harness replays the opponent's setup move, coaches the subsequent candidate move, validates the entire published puzzle line as legal and independently evaluates **before and after** with the bundled Stockfish 17.1. The published puzzle line is NOT silently treated as Stockfish's PV or proof of a forced continuation.

| ID | Theme | Source |
| --- | --- | --- |
| `31-lichess-0066C-bishop-sacrifice` | Bishop capture / dynamic compensation | [Lichess puzzle 0066C](https://lichess.org/ZyuTEP3l#38) |
| `32-lichess-00KNK-knight-tactic` | Knight tactics and replies | [Lichess puzzle 00KNK](https://lichess.org/L8oTZ2cM/black#44) |
| `33-lichess-00sJ9-rook-infiltration` | Rook attack and material | [Lichess puzzle 00sJ9](https://lichess.org/gyFeQsOE#35) |
| `34-lichess-00sO1-bishop-intermezzo` | Bishop counterattack in a busy position | [Lichess puzzle 00sO1](https://lichess.org/vsfFkG0s/black#62) |

These are **real game-derived puzzle positions**, not previously played games by the learner and not a statistically representative benchmark. In the GitHub CI depth-12 run, Stockfish independently selected the recorded move in all four cases. CI also runs the offline harness, the 64 deterministic chess-rule/guard tests, and the two checkmate fixtures.

Use terminal 1 for the proxy (restart after a `git pull` if needed):

```bash
cd ~/chessking
git pull origin main
node local-server.mjs
```

With terminal 1 open, use terminal 2 for the four paid AI calls:

```bash
cd ~/chessking
node tests/coach-ai-regression.mjs --live --group middlegame --stockfish --depth 14 --limit 4
```

Offline engine-only check (no API usage):

```bash
node tests/coach-ai-regression.mjs --group middlegame --stockfish --depth 14
```

The report includes model responses, both raw Stockfish scores and legal PVs, puzzle source attribution, original source continuation and an explicit marker that the source line has **not** been independently proven by Stockfish to be forcing. The engine group remains available separately, without changing its two established checkmate cases.

**No new Lambda code deployment is required for this pack**; it uses the current coach API payload and the local test runner. Its real tactical quality still requires human review of the returned JSON responses.

## Tactical continuation prioritiser (November 24, 2026)

The actual Opening Lab browser coach now generates `tacticalContinuation` from the **post-move Stockfish rank-one principal variation**. The new deterministic `coachTacticalContinuation(position, engineEvidence)` walks up to six legal moves on successive board states and records key events (queen/rook/minor-piece captures, checks, discovered checks from stationary attackers, high-value attacks, recaptures and king moves). It ranks salient events but preserves their original chronological setup; the AI is instructed to teach the main consequence rather than focus on an unimportant first exchange or an invented hypothetical capture.

The Lambda includes the new field in its evidence whitelist and prioritises these board-verified events. Stockfish's PV remains a **forecast**, not a proof every defender response is forced. This does not override higher-confidence tactical or checkmate evidence.

The four real Lichess middlegame tests now verify that live analysed PV moves and extracted events match, and **separately** check the motifs on each published legally validated puzzle continuation. They never assert that Stockfish must choose the same line at different depths, and source puzzle moves are never silently substituted for an engine line. The specific frozen tests include a rook discovered check plus eventual queen capture, a queen recapture after knight checks, a rook taking a bishop, and a bishop move enabling a rook capture.

To retest live after updating your local project and **deploying the updated Lambda separately**:

```bash
cd ~/chessking
git pull origin main
node tests/coach-ai-regression.mjs --live --group middlegame --stockfish --depth 14 --limit 4
```

This makes four paid coach requests. Compare actual response quality, not just zero automatic warnings.

## Balanced coaching regression: everyday play versus tactical mistakes

Four additional positions are available with `--group balance --stockfish`. The purpose is to check that the coach does **not** treat every move as a combination merely because a Stockfish continuation exists.

| ID | Situation | Review criterion |
| --- | --- | --- |
| 35-routine-opening-d4 | Normal first-move central pawn push | Teach centre control without invented forced threats |
| 36-routine-knight-development | Nf3 after d4/d5 | Teach development and the actual defence of d4 accurately |
| 37-quiet-kingside-castling | O-O in a developed position | Teach king safety and rook activation without a fake tactic |
| 38-middlegame-queen-grabs-defended-rook | Black captures a rook on g3 with a queen in a real game-derived middlegame | Explain why White's queen can recapture and why Stockfish penalises the move; do not call the rook free |

Each input is reconstructed using the live application's **legal move generator**, not merely accepted from a stored FEN. Both pre-move and post-move positions receive genuine Stockfish searches. At CI depth 12, the first three moves had small evaluation losses (14, 3 and 22 centipawns), and the final queen capture lost approximately 648 centipawns. The test fails if the supposedly routine moves exceed 90 centipawns of loss or the blunder fails to lose at least 150 centipawns. These are approximate search-depth-dependent measurements, not fixed theoretical valuations. The blunder also requires a legal Qxg3 recapture by White.

The tests use the existing Lambda evidence format: **no Lambda redeployment is required**. On the first terminal, run or restart the local server after updating `main`:

```bash
cd ~/chessking
git pull origin main
node local-server.mjs
```

In the second terminal, run the four live AI calls:

```bash
cd ~/chessking
node tests/coach-ai-regression.mjs --live --group balance --stockfish --depth 14 --limit 4
```

For offline engine-only validation, omit `--live`. The resulting report records the actual coach responses and engine provenance; zero validator warnings are not a human quality score. Review especially whether routine moves receive restrained practical explanations and whether Black's queen-for-rook mistake is described as a **loss**, with legal recapture context.

## Pawn-defence wording and major-blunder guards (November 2026)

The Lambda's deterministic guard checks both "defends your pawn on d4" and "defends your d4 pawn" against the moved piece's exact geometric defences. **Correction:** the knight on f3 really DOES defend a pawn on d4 (f3 to d4 is a valid knight jump). An earlier human assessment and hand-written test mistakenly called this false. The regression now derives pawn defence from the production attack-square generator and correctly ACCEPTS the observed Nf3 response; a knight on c3 claiming to defend d4 is rejected. This guard checks explicit geometric relationships rather than unrestricted natural-language meanings.

For genuine engine-grounded large errors (at least 300 centipawns lost from a same-depth before/after evaluation, analysis depth at least 10, and the played move was not Stockfish's first choice), the coach must explicitly identify a serious mistake or blunder, or describe the major material loss, rather than only describing a plausible tactical exchange. Its correction must use verified legal captures and engine continuations without assuming every reply is forced. This does not label a quiet move or a minor engine disagreement a mistake.

The regression includes **72 deterministic tests**, including the two exact offending live responses. GitHub CI additionally evaluates the real Stockfish engine fixtures. To see whether the generated wording has improved, deploy the latest `lambda-coach/index.mjs` in AWS; pull the latest GitHub main branch and restart the local proxy, then:

```bash
cd ~/chessking
node tests/coach-ai-regression.mjs --live --group balance --stockfish --depth 14 --case 36-routine-knight-development
node tests/coach-ai-regression.mjs --live --group balance --stockfish --depth 14 --case 38-middlegame-queen-grabs-defended-rook
```

These are two paid AI calls in total and produce separate JSON reports. A passing deterministic test does not by itself prove the new live language is good.

## Pawn-defence test correction

The November 24 Nf3 coach response was **already correct**, despite an earlier human review assigning a poor score. The f3 knight attacks d4 and can protect the white d4 pawn. No app-side false-positive warnings were emitted, which was appropriate. The underlying bug was in the deterministic regression's *hand-written* attack-square fixture, not the production board generator or the live coach. Tests 65–67 and 72 now exercise actual production piece-attack geometry instead of manually omitting d4; the prompt explicitly confirms the true relation. Do not treat Nf3 defending d4 as an error.
