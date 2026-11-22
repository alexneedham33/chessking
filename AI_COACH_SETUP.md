# Optional AI coaching (local prototype)

The existing Opening Lab still works as a static website. Its position-based Strategic Insights are the default and do not require an API key.

To try natural-language AI coaching locally:

1. Install Node.js 20 or newer.
2. Create an OpenAI API key and make it available to **your terminal environment**. Never put a key in `index.html`, commit it, or paste it into browser DevTools.
3. From the repository directory, start the local server:

   ```bash
   export OPENAI_API_KEY='YOUR_KEY_HERE'
   node coach-server.mjs
   ```

4. Open **http://127.0.0.1:8787** (not `file://` and not a separate static-file server).
5. In **Learn**, enable **Ideas** and **AI** in the Opening Coach header. AI coaching now starts during the guided opening (from the second half-move) and considers insights about every two half-moves. It may choose not to interrupt when there's nothing useful to say.

The AI feature now sends the current FEN, recent move labels, strategic facts, a few earlier insights, and **cached depth-16 Stockfish analysis** (White-perspective evaluation plus up to three legal principal variations) to the OpenAI Responses API. The model chooses a grounded candidate idea or remains silent, and explains it in natural language. The AI sees Stockfish's calculated possibilities, not its intentions or a guaranteed plan; the chat is educational, not a best-move instruction. Stockfish results are shared from the existing engine cache where available, so AI coaching should not cause unnecessary duplicate analyses. If Stockfish is unavailable, position-based guidance remains; if AI is offline, the existing non-AI insights remain.

Set `OPENAI_COACH_MODEL` to override the default `gpt-4.1-mini` model. `PORT` changes the local port. No extra npm dependencies are required.

**Cost controls:** AI requests are capped at **24 per game** in the browser and **120 per UTC day** by the local server, alongside a 12-request-per-minute limit. Set `OPENAI_COACH_DAILY_LIMIT` to lower the daily allowance (for example `OPENAI_COACH_DAILY_LIMIT=30`), or `0` to block API calls. The server's daily counter is in memory and resets when the server restarts; it is **not** a hard monetary spending limit. For a durable spend limit, configure billing alerts and usage limits on your API account. API usage is billed separately from ChatGPT subscriptions.

**Security:** The prototype binds only to `127.0.0.1`, with same-origin checks and a small in-memory request limit. Do **not** deploy `coach-server.mjs` publicly without authentication, proper rate limiting, usage limits, abuse protection, and monitoring. Any exposed endpoint that uses your API key can incur charges. Hosting the frontend publicly without this backend leaves the existing offline coaching intact.

**Next step:** compare scripted and AI insights on the same saved positions before extending the model to the existing move-by-move coach chat; consider a separate Stockfish assessment for tactical claims.
