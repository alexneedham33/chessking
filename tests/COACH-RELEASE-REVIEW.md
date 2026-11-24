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
