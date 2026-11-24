# ChessKing coach release evaluation

The release suite uses **three distinct scenarios**, never substitutes the Immortal Game for broader coverage, and makes no claim that illustrative scenarios are complete historical games.

- `positional`: quiet developing position from a legal starting-game sequence (5 coached plies).
- `tactical`: independent Opera Game middlegame segment with the verified preceding moves (11 coached plies).
- `endgame`: illustrative king-and-passed-pawn FEN with legally replayed moves (7 coached plies).

These are **development samples**, not a representative statistical benchmark. Stockfish depth 12 evaluations are approximate. The principal variation is a line of play, not a proof that each defender reply is forced.

## Workflow

1. Deploy the latest `lambda-coach/index.mjs` manually to AWS Lambda. Pull `main` on the Mac.
2. Validate and run offline cases without paid calls:
   ```sh
   node tests/coach-game-simulation.mjs --suite release --validate-only
   node tests/coach-game-simulation.mjs --suite release --depth 12
   ```
3. With the existing **loopback coaching proxy** running, perform **one** live batch:
   ```sh
   node tests/coach-game-simulation.mjs --live --suite release --depth 12 --limit 12
   ```
   This makes 23 initial AI requests (5 + 11 + 7) and up to one repair per response. The backend stops additional requests for a scenario after an HTTP 5xx.
4. Evaluate the generated report:
   ```sh
   node tests/coach-release-readiness.mjs tests/reports/coach-games-live-<timestamp>.json
   ```
5. Have a human reviewer inspect **each** accepted explanation against the move and the board/Stockfish evidence in the report. For each accepted entry, fill `humanReview.accuracy` and `humanReview.teaching` on a 1–10 scale, `majorFactualError` as `true` or `false`, and `notes` when needed. Run the readiness checker again. Leave unfounded or unreviewed fields as `null`; do not guess.

## Gates

- At least **five live attempts per scenario** and all three scenarios represented.
- **≥95%** successful responses overall.
- **Zero major factual errors** among reviewed responses.
- Average human accuracy **≥8/10**, teaching usefulness **≥7/10**.
- **100% review coverage** of accepted responses.

The checker returns `AWAITING_HUMAN_REVIEW` when transport reliability passes but explanations have not been independently scored. This is expected and **not** a release sign-off. A small successful sample is not a formal guarantee of accuracy across all chess positions.

The final two narrowly scoped validation changes protect against (a) claiming a pawn attacks a friendly bishop on an occupied square and (b) inventing a knight check on a named square where a verified hypothetical knight move does not check the king. Avoid adding new broad regex rules solely to improve this sample. Treat further isolated minor wording issues as human-review notes and prioritise real repeated major inaccuracies.

## Lambda-backed controlled model comparison

The existing OPENAI_API_KEY stays **only in AWS Lambda**. A separate benchmark token authorizes testing; it is not an OpenAI API key. Production requests still use gpt-5.4-mini (low).

1. Generate a new 32+-character benchmark token locally using `openssl rand -hex 32`. Keep this secret private. Do not commit it.
2. In **AWS Lambda → Configuration → Environment variables**, add:
   - `CHESSKING_BENCHMARK_ENABLED` = `true`
   - `CHESSKING_BENCHMARK_TOKEN` = your newly generated token
   Leave `OPENAI_API_KEY` unchanged. Deploy the latest `lambda-coach/index.mjs` as normal.
3. Run `git pull origin main` locally and start `node local-server.mjs` in one terminal.
4. In a second terminal, enter `read -s CHESSKING_BENCHMARK_TOKEN; export CHESSKING_BENCHMARK_TOKEN`, paste the exact token and press Enter. The token will not be echoed.
5. Generate identical evidence fixtures: `node tests/coach-game-simulation.mjs --suite release --depth 12 --export-benchmark`.
6. Smoke test three calls (one position × three configurations): `node tests/coach-model-benchmark.mjs --live --max-cases 1 --max-cost-usd 3 --out tests/reports/coach-model-benchmark-smoke.json`.
7. Run full benchmark: `node tests/coach-model-benchmark.mjs --live --max-cost-usd 15`. This makes up to 45 initial model calls and, if validation fails, up to 45 additional repair calls. Reports are saved after each response. Resume only with `--resume` and the same output path, avoiding duplicate paid calls.
8. Review `tests/reports/coach-model-benchmark-results.json` for accuracy and teaching quality; `node tests/coach-model-benchmark.mjs --compare tests/reports/coach-model-benchmark-results.json` displays model comparisons.
9. **After testing, change `CHESSKING_BENCHMARK_ENABLED` to `false` in Lambda (or remove both benchmark environment variables)**.

Benchmark routes are restricted to the loopback proxy and protected in Lambda by a strong, independent token and an explicit enable flag. The token is passed only to the existing AWS API and not embedded in browser code. Allowed models are hardcoded server-side. Normal coaching requests retain the original model, prompt, validation and completion cap.

The `--max-cost-usd` value is a local best-effort usage guard: it checks reported costs before new calls, **not a guaranteed billing limit**. The three configurations have different per-token costs and may spend differently on reasoning. No API calls happen when running self-tests or exporting fixtures.
