#!/usr/bin/env bash
# Rebuild everything the sandbox does not persist, then start the stack.
#
# Arena recycles the sandbox between sessions: /tmp, globally installed npm
# packages, backend/.venv, frontend/node_modules and the gitignored .env files
# all disappear, while the repo (and untracked files inside it) come back from a
# snapshot. Run this after a recycle:
#
#   bash sandbox/bootstrap.sh          # rebuild + start mongo/backend/frontend
#   bash sandbox/bootstrap.sh --check  # rebuild only, print what is missing
#
# It is idempotent - steps that are already done are skipped.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REGISTRY_PORT=4873
REGISTRY="http://127.0.0.1:${REGISTRY_PORT}/"
MONGO_PORT=27017
BACKEND_PORT=8000
ADMIN_MOBILE="${ADMIN_MOBILE:-9602341799}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"   # matches backend/tests/*.py
CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[fail]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$REPO" || die "cannot cd to $REPO"

# --------------------------------------------------------------------------- #
# 0. git: after a recycle .git may be a fresh clone at the base commit while the
#    working tree already holds our changes. Re-sync the branch from the remote
#    without touching the files.
# --------------------------------------------------------------------------- #
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
    REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
    LOCAL_SHA="$(git rev-parse HEAD)"
    if [[ -n "$REMOTE_SHA" && "$REMOTE_SHA" != "$LOCAL_SHA" ]]; then
      say "git: local HEAD $LOCAL_SHA != origin/$BRANCH $REMOTE_SHA - re-syncing index only"
      git fetch -q origin "$BRANCH" && git reset --mixed "$REMOTE_SHA" >/dev/null
      say "git: HEAD is now $(git rev-parse --short HEAD)"
    fi
  fi
fi

# --------------------------------------------------------------------------- #
# 1. Python venv + backend deps (the full requirements.txt pins packages that
#    are irrelevant at runtime and some that are not installable here).
# --------------------------------------------------------------------------- #
VENV="$REPO/backend/.venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  say "python: creating $VENV"
  python3 -m venv "$VENV" || die "venv creation failed"
  "$VENV/bin/pip" install -q --upgrade pip
  say "python: installing backend deps"
  "$VENV/bin/pip" install -q \
    fastapi==0.110.1 "uvicorn==0.25.0" motor==3.3.1 pymongo==4.6.3 \
    razorpay==2.0.1 PyJWT==2.15.1 bcrypt==4.1.3 requests python-dotenv \
    python-multipart==0.0.32 pydantic==2.13.5 starlette==0.37.2 mongomock \
    || die "pip install failed"
else
  say "python: venv already present"
fi
"$VENV/bin/python" -c "import fastapi, motor, razorpay, jwt, bcrypt, mongomock" \
  || die "backend imports failed"

# --------------------------------------------------------------------------- #
# 2. Local npm registry + stubs for the two @emergentbase devDependencies that
#    live on assets.emergent.sh (unreachable here). craco.config.js fails open
#    without them, so no-op stubs are enough to let yarn resolve the graph.
# --------------------------------------------------------------------------- #
mkdir -p /tmp/verdaccio/storage /tmp/stubs/overlay /tmp/stubs/visual-edits

cat > /tmp/verdaccio/config.yaml <<EOF
storage: /tmp/verdaccio/storage
auth:
  htpasswd:
    file: /tmp/verdaccio/htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    max_fails: 5
    timeout: 60s
packages:
  '@emergentbase/*':
    access: \$all
    publish: \$all
    unpublish: \$all
  '@*/*':
    access: \$all
    publish: \$all
    proxy: npmjs
  '**':
    access: \$all
    publish: \$all
    proxy: npmjs
listen: 127.0.0.1:${REGISTRY_PORT}
log: { type: stdout, format: pretty, level: warn }
max_body_size: 100mb
EOF

cat > /tmp/stubs/overlay/package.json <<'EOF'
{"name":"@emergentbase/overlay","version":"0.1.29","main":"index.js","license":"MIT"}
EOF
echo "module.exports = {};" > /tmp/stubs/overlay/index.js
cat > /tmp/stubs/overlay/craco.js <<'EOF'
// Sandbox stub: no-op error overlay (upstream package is not reachable here).
const noopPlugin = { apply() {} };
module.exports.emergentOverlayCraco = () => ({
  devServer: (cfg) => cfg,
  attach: () => {},
  webpackPlugin: noopPlugin,
});
EOF

cat > /tmp/stubs/visual-edits/package.json <<'EOF'
{"name":"@emergentbase/visual-edits","version":"1.0.13","main":"index.js","license":"MIT"}
EOF
echo "module.exports = {};" > /tmp/stubs/visual-edits/index.js
cat > /tmp/stubs/visual-edits/craco.js <<'EOF'
// Sandbox stub: visual editing disabled (upstream package is not reachable here).
module.exports.withVisualEdits = (cfg) => cfg;
EOF

if ! command -v verdaccio >/dev/null 2>&1; then
  say "npm: installing verdaccio globally"
  npm install -g verdaccio@6.10.4 >/dev/null 2>&1 || die "verdaccio install failed"
fi

if ! curl -sf -o /dev/null "$REGISTRY"; then
  say "npm: starting verdaccio on 127.0.0.1:${REGISTRY_PORT}"
  (nohup verdaccio --config /tmp/verdaccio/config.yaml > /tmp/verdaccio/out.log 2>&1 &)
  for _ in $(seq 1 30); do curl -sf -o /dev/null "$REGISTRY" && break; sleep 1; done
  curl -sf -o /dev/null "$REGISTRY" || die "verdaccio did not come up (see /tmp/verdaccio/out.log)"
else
  say "npm: verdaccio already running"
fi

say "npm: publishing @emergentbase stubs"
python3 - <<'PY' || die "stub publish failed"
import base64, hashlib, io, json, os, tarfile, urllib.request
BASE = "http://127.0.0.1:4873"
body = json.dumps({"name": "pub", "password": "pubpass123",
                   "email": "pub@example.com", "type": "user", "roles": []}).encode()
req = urllib.request.Request(BASE + "/-/user/org.couchdb.user:pub", data=body,
                            headers={"Content-Type": "application/json"}, method="PUT")
try:
    tok = json.load(urllib.request.urlopen(req))["token"]
except urllib.error.HTTPError as e:      # already registered from a previous run
    if e.code != 409:
        raise
    login = json.dumps({"name": "pub", "password": "pubpass123"}).encode()
    req = urllib.request.Request(BASE + "/-/user/org.couchdb.user:pub", data=login,
                                headers={"Content-Type": "application/json"}, method="PUT")
    tok = json.load(urllib.request.urlopen(req))["token"]

def tgz_of(d):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for fn in sorted(os.listdir(d)):
            tf.add(os.path.join(d, fn), arcname="package/" + fn)
    return buf.getvalue()

def publish(d, name, version):
    blob = tgz_of(d)
    fname = "%s-%s.tgz" % (name.split("/")[1], version)
    doc = {"_id": name, "name": name, "description": "sandbox stub",
           "dist-tags": {"latest": version},
           "versions": {version: {"name": name, "version": version, "main": "index.js",
                                  "dist": {"tarball": "%s/%s/-/%s" % (BASE, name, fname),
                                           "shasum": hashlib.sha1(blob).hexdigest()}}},
           "_attachments": {fname: {"content_type": "application/octet-stream",
                                    "data": base64.b64encode(blob).decode(),
                                    "length": len(blob)}}}
    req = urllib.request.Request(BASE + "/" + name.replace("/", "%2f"),
                                data=json.dumps(doc).encode(),
                                headers={"Content-Type": "application/json",
                                         "Authorization": "Bearer " + tok}, method="PUT")
    try:
        urllib.request.urlopen(req)
        print("  published", name, version)
    except urllib.error.HTTPError as e:
        if e.code != 409:
            raise
        print("  already present:", name, version)

publish("/tmp/stubs/overlay", "@emergentbase/overlay", "0.1.29")
publish("/tmp/stubs/visual-edits", "@emergentbase/visual-edits", "1.0.13")
PY

# --------------------------------------------------------------------------- #
# 3. .env files (gitignored, so never in the snapshot)
# --------------------------------------------------------------------------- #
if [[ ! -f "$REPO/backend/.env" ]]; then
  say "env: writing backend/.env"
  SECRET="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')"
  cat > "$REPO/backend/.env" <<EOF
# Local sandbox development config (gitignored). Replace with real values in a deployed env.
MONGO_URL=mongodb://127.0.0.1:${MONGO_PORT}
DB_NAME=pitchplay
JWT_SECRET=${SECRET}
ADMIN_MOBILE=${ADMIN_MOBILE}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_UPI_ID=${ADMIN_MOBILE}@upi
CORS_ORIGINS=*
# Razorpay keys (TEST mode) - paste real values to enable online payments
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RAZORPAYX_ACCOUNT_NUMBER=
EOF
else
  say "env: backend/.env already present"
fi

if [[ ! -f "$REPO/frontend/.env" ]]; then
  say "env: writing frontend/.env"
  cat > "$REPO/frontend/.env" <<'EOF'
# Local sandbox development config (gitignored).
#
# Empty backend URL -> the browser calls same-origin /api, which the CRA dev
# server proxies to http://127.0.0.1:8000 (see "proxy" in package.json). That
# keeps the app working behind the sandbox preview host, which the browser can
# only reach through the proxy URL (never 127.0.0.1).
REACT_APP_BACKEND_URL=

HOST=0.0.0.0
PORT=3000
BROWSER=none
# The dev server is served through a sandbox preview hostname; allow it.
DANGEROUSLY_DISABLE_HOST_CHECK=true
# The browser is remote, so let the webpack HMR socket use the page's own host/port.
WDS_SOCKET_PORT=0
EOF
else
  say "env: frontend/.env already present"
fi

printf 'registry "%s"\n' "$REGISTRY" > "$REPO/frontend/.yarnrc"

# --------------------------------------------------------------------------- #
# 4. frontend deps. A yarn.lock from a previous sandbox pins the stub tarballs by
#    hash; the stubs are regenerated each time, so a stale lock fails the
#    integrity check and must be dropped.
# --------------------------------------------------------------------------- #
if [[ ! -d "$REPO/frontend/node_modules/react-scripts" ]]; then
  say "npm: yarn install (a few minutes)"
  rm -f "$REPO/frontend/yarn.lock"
  (cd "$REPO/frontend" && yarn install --network-timeout 600000) \
    || die "yarn install failed (log above)"
else
  say "npm: node_modules already present"
fi

if [[ "$CHECK_ONLY" == "1" ]]; then
  say "--check: rebuild complete, not starting any server"
  exit 0
fi

# --------------------------------------------------------------------------- #
# 5. Start the stack. Order matters: mongo -> backend -> frontend.
# --------------------------------------------------------------------------- #
start_bg() {  # name, log, command...
  local name="$1" log="$2"; shift 2
  (nohup "$@" > "$log" 2>&1 &)
  say "started $name (log: $log)"
}

curl -sf -o /dev/null "http://127.0.0.1:${MONGO_PORT}" 2>/dev/null
if ! pgrep -f "dev_mongo.py --port ${MONGO_PORT}" >/dev/null 2>&1; then
  start_bg "dev mongo shim" /tmp/dev-mongo.log \
    "$VENV/bin/python" "$REPO/sandbox/dev_mongo.py" \
    --port "$MONGO_PORT" --db-file "$REPO/sandbox/dev_mongo.json"
  sleep 2
fi

if ! pgrep -f "uvicorn server:app" >/dev/null 2>&1; then
  (cd "$REPO/backend" && nohup ./.venv/bin/python -m uvicorn server:app \
    --host 127.0.0.1 --port "$BACKEND_PORT" > /tmp/backend.log 2>&1 &)
  say "started backend on 127.0.0.1:${BACKEND_PORT} (log: /tmp/backend.log)"
  for _ in $(seq 1 30); do
    curl -sf -o /dev/null "http://127.0.0.1:${BACKEND_PORT}/api/debug/auth" && break
    sleep 1
  done
fi

say "starting frontend (use your process tool for this one so it registers as the live preview)"
echo "    cd $REPO/frontend && yarn start"
echo
echo "Sign in: admin ${ADMIN_MOBILE} / ${ADMIN_PASSWORD}   (user app: /app, admin console: /admin)"
