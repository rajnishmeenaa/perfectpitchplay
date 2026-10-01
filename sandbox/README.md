# Running PitchPlay in this sandbox

Everything here exists because the Arena sandbox has a **network allow-list**:
`pypi.org`, `registry.npmjs.org` and `github.com/codeload.github.com` are
reachable, but `assets.emergent.sh`, `*.mongodb.org`, `integrations.emergentagent.com`
and the Debian apt mirrors are **not**. So a stock `yarn install && uvicorn` does
not work out of the box, and there is no `mongod` to install. This folder holds
the two workarounds.

Nothing in here changes app behaviour in a deployed environment — `backend/server.py`
and `frontend/src/**` are untouched.

## After a sandbox recycle

Arena recycles the sandbox between sessions. The repo comes back from a snapshot
(including untracked files inside it, e.g. `frontend/.yarnrc`), but everything
outside it is gone: `/tmp`, globally installed npm packages, `backend/.venv`,
`frontend/node_modules` and the gitignored `.env` files. `.git` may also come back
as a fresh clone at the base commit while the working tree still holds our changes.

One command rebuilds all of it:

```bash
bash sandbox/bootstrap.sh          # re-sync git, rebuild deps, start mongo + backend
bash sandbox/bootstrap.sh --check  # rebuild only, do not start anything
```

It is idempotent, then prints the `yarn start` line for the frontend - start that
one with the process tool so it registers as the live preview.

Two recycle-specific traps it handles:

* a `yarn.lock` from the previous sandbox pins the `@emergentbase` stub tarballs by
  hash, and the stubs are regenerated each time, so the stale lock fails yarn's
  integrity check and is dropped;
* the git branch is re-synced with `git fetch` + `git reset --mixed` so history
  matches the remote without touching the restored files.

## What runs

| Process | Command | Port | Visible as preview |
| --- | --- | --- | --- |
| Dev MongoDB shim | `backend/.venv/bin/python sandbox/dev_mongo.py` | 127.0.0.1:27017 | no |
| Backend (FastAPI) | `cd backend && ./.venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8000` | 127.0.0.1:8000 | no |
| Frontend (CRA/craco) | `cd frontend && yarn start` | 0.0.0.0:3000 | yes ← the only preview |
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

## "Request failed with status code 401" in the preview

Seen in practice, and worth knowing because two different causes look identical
from the browser:

1. **The session was thrown away by a transient failure.** `AuthProvider.refresh()`
   used to clear the stored token whenever `GET /api/auth/me` failed for *any*
   reason, so restarting the backend (or a hiccup in the preview proxy) logged the
   open tab out. Every later request then went out with no `Authorization` header
   and the backend answered `401 {"detail":"Missing token"}`. It now only clears
   the token on a real 401/403.
2. **The preview iframe could not keep the token.** `lib/api.js` now keeps the
   token in memory as well as `localStorage`, verifies that a write actually stuck,
   and warns if the browser is blocking storage for the preview origin.

Both used to surface as a raw unhandled `AxiosError` because the admin panels fetch
with `.then()` and no `.catch()`. `lib/api.js` now has a response interceptor that
turns a 401 into a clear sign-out message instead.

To see what actually reached the server from your browser, open
`/api/debug/auth` in the preview (read-only, reveals no secret): it reports whether
the `Authorization` header arrived, whether the token decodes, and which user/role
it maps to. If `authorization_header_present` is `false` while you are signed in,
the token is not being stored or the header is being stripped upstream.

Note the backend deliberately binds `127.0.0.1`, so only the frontend is offered as
a preview. When it was bound to `0.0.0.0` the raw API also appeared as a preview,
which is a second origin that shares the sandbox preview domain — signing in on one
and browsing the other produces exactly this class of confusion.
