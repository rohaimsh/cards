# The GCS relay (`api/`)

The pages call `/api/gcs/<name>` on their own address. This Azure Function (inside the Static Web App, Free plan) adds the secret key of the matching Power Automate flow and passes the request on.
The flow addresses are never in a page or in this repository: they are the Static Web App's settings `FLOW_CARD`, `FLOW_TRACK`, `FLOW_VCARD`, `FLOW_READER`, `FLOW_SAVE`, `FLOW_PUBLISH`
and `FLOW_ADMIN`, written by `python3 tools/protect_flow_keys.py --sync` (and replaced by `--rotate --yes`).

- `src/relay.js` all the decisions (routes, size and shape, origin, what is passed on and what is not). Plain code, no outside package, tested by `node tests/test_api_relay.js`.
- `src/functions/gcs.js` the one Azure Function: it hands the request to `relay()`.
- `GET /api/gcs/ping` says how many of the seven settings exist (never which, never their values).

Read `docs/PRIVATE-FLOW-KEYS.md` for what it does and does not do and for the steps. Deployed by the GitHub Actions workflow (`api_location: "api"`), runtime `node:22` set in `staticwebapp.config.json`.
