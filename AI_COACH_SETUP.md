# Optional AI move coaching (local prototype)

Opening Lab works without an API key, using its built-in move-by-move explanations. AI coaching optionally replaces those explanations with a single contextual message grounded in the actual played move and Stockfish calculations.

## Start locally

1. Install Node.js 20 or newer.
2. Create an OpenAI API key. Never put it in the repository, HTML, screenshots or browser DevTools.
3. Run these commands from the repository directory:

   ```bash
   export OPENAI_API_KEY='YOUR_KEY_HERE'
   node coach-server.mjs
   ```

4. Open **http://127.0.0.1:8787**.
5. Enable **AI** in the Opening Coach header.

When enabled, the app requests an AI explanation starting at the second half-move, generally once every two half-moves, up to the per-game allowance. The original explanation appears immediately. While Stockfish and the API work, the same message says **Refining with AI + Stockfish…**, then the explanation is replaced in place. There is **no separate Strategic Idea box** or Ideas switch.

Each request includes the **actual move played** (UCI, notation, mover, piece, capture, check and castling), the positions before and after, the original explanation, recent move and coaching history, and the existing cached depth-16 Stockfish evaluation with up to three legal candidate continuations. The AI is instructed not to confuse an engine continuation with the move actually played and not to invent chess threats. Stockfish calculates possible continuations; it does not literally describe its strategic intentions. If AI is unavailable, the original explanation remains.

The optional `OPENAI_COACH_MODEL` setting overrides the default `gpt-4.1-mini` model. `PORT` changes the local port. No npm dependencies are required.

## Costs and security

Requests are capped at **24 per game** in the browser, **120 per UTC day** in the local server, and **12 per minute**. You can lower the daily allowance using `OPENAI_COACH_DAILY_LIMIT=30` (or set 0 to disable paid calls). The server counter is **in memory and resets when restarted**, not a permanent monetary cap. Set API usage alerts and account limits separately. API charges are separate from ChatGPT subscriptions.

The prototype binds to `127.0.0.1` with same-origin checking. **Do not expose this unauthenticated server publicly.** Production use requires authentication, persistent budgets, monitoring, rate limiting and abuse safeguards.

The API route for the unified coach is `POST /api/coach/move`; `GET /api/coach/status` reports configuration and the current server budget.

## Validation

Compare the unified AI explanation with the scripted fallback and the board for a variety of normal developing moves, captures, checks and mistakes. Confirm that it always describes the actual played move, not one of Stockfish's proposed next moves.
