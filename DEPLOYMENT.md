# GitHub Pages deployment notes

- Publish source: repository root via GitHub Actions.
- All browser assets use relative paths, so repository subdirectory URLs work.
- `.nojekyll` prevents Jekyll from filtering static files.
- `config.js` has an empty `apiBaseUrl` and contains no API key.
- `api/communicate.js` is the server-side Gemini proxy. Deploy it to a Node-compatible serverless platform and store `GEMINI_API_KEY` only in that platform's secret environment settings.
- Set `ALLOWED_ORIGINS` to the exact GitHub Pages origin, for example `https://n124654262-ai.github.io`.
- After the backend is deployed, set `config.js` `apiBaseUrl` to `https://YOUR-BACKEND/api/communicate`.
- Microphone input requires HTTPS, a user gesture, browser permission, and browser support for Web Speech API.
