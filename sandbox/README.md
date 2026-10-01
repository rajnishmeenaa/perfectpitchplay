# Running PitchPlay in this sandbox

Everything here exists because the Arena sandbox has a **network allow-list**:
`pypi.org`, `registry.npmjs.org` and `github.com/codeload.github.com` are
reachable, but `assets.emergent.sh`, `*.mongodb.org`, `integrations.emergentagent.com`
and the Debian apt mirrors are **not**. So a stock `yarn install && uvicorn` does
not work out of the box, and there is no `mongod` to install. This folder holds
the two workarounds.

Nothing in here changes app behaviour in a deployed environment — `backend/server.py`
and `frontend/src/**` are untouched.

## What runs

| Process | Command | Port | Visible as preview |
| --- | --- | --- | --- |
| Dev MongoDB shim | `backend/.venv/bin/python sandbox/dev_mongo.py` | 127.0.0.1:27017 | no |
| Backend (FastAPI) | `cd backend && ./.venv/bin/python -m uvicorn server:app --host 0.0.0.0 --port 8000` | 0.0.0.0:8000 | yes |
| Frontend (CRA/craco) | `cd frontend && yarn start` | 0.0.0.0:3000 | yes ← open this one |
| Verdaccio (npm mirror) | `verdaccio --config /tmp/verdaccio/config.yaml` | 127.0.0.1:4873 | no |

## `dev_mongo.py` — local MongoDB stand-in

`sandbox/dev_mongo.py` speaks enough of the MongoDB wire protocol (OP_MSG) to let
`motor.AsyncIOMotorClient` talk to it, backed by `mongomock`. Implemented:
`hello`/`ping`, `find`, `insert`, `update` (incl. upserts), `delete`, `count`,
`distinct`, `findAndModify`, `listCollections`, and the `$match`/`$skip`/`$limit`/
`$group:{$sum:1}` aggregation that `count_documents()` generates.

Data is snapshotted to `sandbox/dev_mongo.json` (gitignored) after every write and
reloaded on start, so it survives restarts. Delete that file for a clean database.

Limits: no transactions, no real indexes, no change streams, no `$lookup`-style
aggregation. **Dev shim only — never point production at it.**

## Frontend install: local npm mirror

`frontend/package.json` pins two devDependencies to tarballs on
`assets.emergent.sh`, which this sandbox cannot reach:

* `@emergentbase/overlay` — branded error overlay
* `@emergentbase/visual-edits` — visual editing in the dev server

`craco.config.js` already fails open when either is missing, so they are only
cosmetic. To install without them, a local Verdaccio registry (127.0.0.1:4873)
proxies npmjs and serves no-op stub packages for those two names, and
`frontend/.yarnrc` (untracked) points yarn at it. The two `package.json` entries
were changed from the `https://assets.emergent.sh/...` tarball URLs to plain
version numbers (`0.1.29` / `1.0.13`) so yarn resolves them from the mirror.

To restore the original behaviour in an environment with internet access:
revert those two lines to the tarball URLs and delete `frontend/.yarnrc`.

## Browser → backend routing

The preview host is not the sandbox, so browser code must never call
`127.0.0.1`. Instead:

* `frontend/.env` sets `REACT_APP_BACKEND_URL=` (empty) → `src/lib/api.js` builds
  `/api/...`, i.e. same-origin relative URLs.
* `frontend/package.json` has `"proxy": "http://127.0.0.1:8000"` and
  `craco.config.js` re-scopes it to `[{ context: ["/api"], target }]`. The scope
  matters: react-scripts turns a bare `proxy` string into a catch-all middleware
  that also swallows the SPA's client-side routes (`/app`, `/admin` would 404
  instead of falling through to `historyApiFallback`). The config object form is
  required because the pinned webpack-dev-server is v5.
* `frontend/.env` also sets `HOST=0.0.0.0`, `DANGEROUSLY_DISABLE_HOST_CHECK=true`
  (required because CRA enables the host check whenever `proxy` is set) and
  `WDS_SOCKET_PORT=0` so hot reload uses the preview host.

## Credentials / env

`backend/.env` (gitignored, recreated for this sandbox):

```
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=pitchplay
JWT_SECRET=<random>
ADMIN_MOBILE=9602341799
ADMIN_PASSWORD=admin123     # matches backend/tests/*.py
ADMIN_UPI_ID=9602341799@upi
CORS_ORIGINS=*
RAZORPAY_KEY_ID=            # empty → online payments disabled
```

Sign in at `/admin` with `9602341799` / `admin123`, or create a normal user at
`/app`.

## Known gaps in the sandbox

* **Payment screenshot upload fails** — files go to the Emergent object storage
  (`integrations.emergentagent.com`), which is blocked. Razorpay/manual-entry
  approval flows can still be exercised for everything except the image bytes.
* **Razorpay checkout is disabled** — no test keys in `.env`. Add
  `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to enable it (the manual UPI flow is
  the fallback and is on by default).
* **Google sign-in cannot complete** — `auth.emergentagent.com` is blocked. Use
  the simulated-Google-user recipe in `auth_testing.md` instead.
* `public/index.html` loads `assets.emergent.sh/scripts/emergent-main.js` and
  PostHog; both are blocked here and fail silently without affecting the app.
