# Opening Lab

Interactive chess opening trainer with guided moves, Quick/Learn explanations, adaptive route guidance, position balance, and forward simulation.

## Run locally in VS Code

1. Clone this repository and open the folder in VS Code.
2. Go to **Actions → Install Stockfish engine → Run workflow** if the Stockfish assets are not yet present in the repository.
3. Once the workflow succeeds, pull the updated `main` branch to receive the JavaScript and WebAssembly engine files.
4. In a VS Code terminal, run `python3 -m http.server 8000` (or open `index.html` with Live Server).
5. Visit **http://localhost:8000/**.

You **must use a local HTTP server**; opening `index.html` via `file://` prevents the Web Worker from loading reliably.

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
