# Auth Testing Playbook (Emergent Google Auth + existing JWT)

PitchPlay uses TWO auth paths that both issue the SAME app JWT (stored in localStorage, sent as `Authorization: Bearer`):
1. Mobile + password (existing) — admin and users.
2. Emergent-managed Google sign-in (users only).

## Google flow
- Frontend "Continue with Google" → redirects to `https://auth.emergentagent.com/?redirect=<origin>/app`.
- User returns to `<origin>/app#session_id=XXX`.
- `AppRoutes` detects `session_id` in `location.hash` and renders `AuthCallback`.
- `AuthCallback` POSTs `{session_id}` to `/api/auth/google/session`.
- Backend calls `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data` with `X-Session-ID`, finds/creates user by email, mints app JWT, returns `{token, user, needs_mobile}`.
- Frontend stores token, navigates to `/app`.
- If `!user.mobile` → `UserApp` renders the `MobileGate` (data-testid `mobile-gate`) — user must enter mobile → POST `/api/auth/set-mobile` → lobby.

## Simulate a Google user WITHOUT real OAuth (for automated tests)
```bash
cd /app/backend && python3 -c "
import os, uuid, jwt
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv('.env')
db = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
uid=str(uuid.uuid4())
db.users.insert_one({'id':uid,'name':'Google Tester','email':'gtest@example.com','mobile':None,'role':'user','wallet_balance':0.0,'created_at':datetime.now(timezone.utc).isoformat()})
print(jwt.encode({'sub':uid,'role':'user','exp':datetime.now(timezone.utc)+timedelta(days=30)}, os.environ['JWT_SECRET'], algorithm='HS256'))
"
```
Then in browser: `localStorage.setItem('token', '<TOKEN>')`, navigate to `/app` → expect `mobile-gate`. Fill `gate-mobile-input`, click `gate-mobile-submit` → expect `user-app` lobby.
Cleanup: `db.users.delete_many({'email':'gtest@example.com'})`.

## Key data-testids
- `google-signin-btn` (landing)
- `auth-callback` (signing-in screen)
- `mobile-gate`, `gate-mobile-input`, `gate-mobile-submit`, `gate-logout-btn`
- `user-app` (lobby)

## Real session_id endpoints
- `GET /api/auth/me` → returns `needs_mobile` flag.
- `POST /api/auth/google/session` `{session_id}` → 401 if invalid/expired.
- `POST /api/auth/set-mobile` `{mobile}` (Bearer auth) → 400 if mobile already registered.
