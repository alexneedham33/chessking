# Opening Lab

Interactive chess opening trainer with guided moves, Quick/Learn explanations, adaptive route guidance, position balance, and forward simulation.

## Run locally in VS Code

1. Clone this repository and open the folder in VS Code.
2. Go to **Actions → Install Stockfish engine → Run workflow** if the Stockfish assets are not yet present in the repository.
3. Once the workflow succeeds, pull the updated `main` branch to receive the JavaScript and WebAssembly engine files.
4. In a VS Code terminal, run `python3 -m http.server 8000` (or open `index.html` with Live Server).
5. Visit **http://localhost:8000/**.

You **must use a local HTTP server**; opening `index.html` via `file://` prevents the Web Worker from loading reliably.

## AI Coach and personal API keys

The chessboard and Stockfish do **not** need an OpenAI API key. AI coaching calls
`POST /api/coach/move`, which must be handled by a **separate backend server**.
The basic `python3 -m http.server 8000` command serves static files only and
does not implement that endpoint.

Each developer can use their **own** OpenAI account and billing:

1. Create an OpenAI API key in their own OpenAI account.
2. Copy `.env.example` to `.env` on their computer.
3. Replace the placeholder in `.env` with their personal key.
4. Configure and launch the **AI backend** to load that environment variable.
   The backend should never send the key to browser JavaScript.

**Important:** This repository currently documents the static front end; it
does not contain a confirmed implementation or launcher for
`/api/coach/move`. Simply creating `.env` does not enable AI coaching;
you also need the same backend you're using for your existing local setup,
or a separately hosted compatible backend.

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
