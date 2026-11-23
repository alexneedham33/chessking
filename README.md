# Opening Lab

Interactive chess opening trainer with guided moves, Quick/Learn explanations, adaptive route guidance, position balance, and forward simulation.

## Run locally in VS Code

1. Clone this repository and open the folder in VS Code.
2. Go to **Actions → Install Stockfish engine → Run workflow** if the Stockfish assets are not yet present in the repository.
3. Once the workflow succeeds, pull the updated `main` branch to receive the JavaScript and WebAssembly engine files.
4. In a VS Code terminal, run `node local-server.mjs` (Node.js 18 or newer).
5. Visit **http://127.0.0.1:8000/**. The local server serves the chessboard and forwards `POST /api/coach/move` to the existing AWS API Gateway/Lambda AI coach.

You can still run `python3 -m http.server 8000` for an offline chessboard/Stockfish-only session, but Python's basic HTTP server cannot handle AI-coach POST requests and will return HTTP 501. Stop any existing server on port 8000 with Ctrl+C before switching.

You **must use a local HTTP server**; opening `index.html` via `file://` prevents the Web Worker from loading reliably.

## AI Coach and personal API keys

The chessboard and Stockfish do **not** need an OpenAI API key. AI coaching calls
`POST /api/coach/move`, which must be handled by a **separate backend server**.
The `local-server.mjs` command implements that endpoint locally by forwarding
requests to the existing deployed AWS API Gateway/Lambda coach. No OpenAI API key
is needed on the local machine for this path. The hosted API remains subject
to its AWS throttling and OpenAI usage limits. The simple Python static server
does not implement the endpoint.

Each developer can use their **own** OpenAI account and billing:

1. Create an OpenAI API key in their own OpenAI account.
2. Copy `.env.example` to `.env` on their computer.
3. Replace the placeholder in `.env` with their personal key.
4. Configure and launch the **AI backend** to load that environment variable.
   The backend should never send the key to browser JavaScript.

**Important:** `local-server.mjs` is a development-only forwarding proxy,
not the AI backend itself. It requires the deployed AWS API Gateway/Lambda
endpoint to be reachable, and that endpoint must be separately secured before
wider public access. Simply creating `.env` does not enable AI coaching; the
OpenAI API key belongs in the backend, not in the browser or local proxy.

`.env` and `.env.*` are ignored by Git; only the placeholder
`.env.example` is committed. Never commit API keys to GitHub.

## Stockfish assets

Opening Lab expects both files in the repository root, beside `index.html`:

- `stockfish-17.1-lite-single-03e3232.js`
- `stockfish-17.1-lite-single-03e3232.wasm`

The included GitHub Actions workflow fetches the exact assets from the pinned `stockfish@17.1.0` npm package and commits them to this repository. If the workflow cannot write to `main`, download the two engine files manually from the package. Do not commit unrelated repositories.

## Notes

The balance bar uses **Stockfish chess evaluation**, not a literal probability of winning. It changes after a complete White/Black move pair. Strategic alignment labels are separate teaching guidance, not engine-generated classifications. The forward simulation is an illustrative, depth-limited engine continuation, not a guaranteed line of play.

The entire app runs locally in your browser once the engine files are downloaded. It is not deployed automatically on GitHub Pages.

## Engine licence

Stockfish is free software licensed under GPLv3. If redistributing Stockfish engine files, comply with its licensing and source-distribution obligations. See https://github.com/official-stockfish/Stockfish and the licence provided with the npm distribution.

## Deploy the AWS AI coach

The deployed AWS Lambda function is managed separately from the static website.
Its version-controlled handler is at `lambda-coach/index.mjs`.
After updating the frontend or prompt contract, copy that file's contents into
AWS Lambda function `opening-lab-coach` → Code → `index.mjs` and click
**Deploy**. This manual Lambda deployment is required; Amplify/GitHub only
deploy the website.

The coach request includes deterministic board occupancy and key-square attack
facts from `index.html`, plus plain-English legal moves and Stockfish evidence.
The handler instructs the model to explain moves without algebraic shorthand
(e.g. "move the queen to d2" rather than "7.Qd2") and avoid unverified
tactical interpretations. These instructions reduce errors but do not
mathematically guarantee chess accuracy. Test several known positions,
especially mistakes and suggestions, after deploying.

The AWS endpoint is currently protected only by throttling, not authentication.
Do not expose it for unrestricted public use; implement API access protection,
request validation and spending safeguards first.
