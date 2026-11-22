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
5. In **Learn**, enable **AI** next to Strategic Insights. Continue past the guided opening.

The AI feature sends the current FEN, the latest move labels, a few computed strategic facts, previously displayed coaching, and verified candidate ideas to the OpenAI Responses API. The model may choose a candidate or say nothing, and can reword the insight. Its output is not engine analysis, and should not be treated as a best move. The existing position-based insight remains if the API is offline or times out.

Set `OPENAI_COACH_MODEL` to override the default `gpt-6-luna` model. `PORT` changes the local port. No extra npm dependencies are required.

**Security:** The prototype binds only to `127.0.0.1`, with same-origin checks and a small in-memory request limit. Do **not** deploy `coach-server.mjs` publicly without authentication, proper rate limiting, usage limits, abuse protection, and monitoring. Any exposed endpoint that uses your API key can incur charges. Hosting the frontend publicly without this backend leaves the existing offline coaching intact.

**Next step:** compare scripted and AI insights on the same saved positions before extending the model to the existing move-by-move coach chat; consider a separate Stockfish assessment for tactical claims.
