# Backend + deployment notes

## Layout
- `/` — React 18 + Vite frontend (deploy to **Vercel**; `vercel.json` included)
- `/server` — Node 20 + Express + Mongoose API (deploy to **Render**; `render.yaml` included, `rootDir: server`)

## Local dev
```bash
cd server && cp .env.example .env   # fill in MongoDB + SUPERADMIN_EMAIL etc.
npm install && npm run seed:demo    # super admin + demo client library
npm run dev                         # http://localhost:4000  (GET /health)
cd .. && npm install && npm run dev # http://localhost:3001  (/api proxied to :4000)
```
For local Google sign-in, run the API on the registered redirect URI port (`PORT=5000 npm run dev`) and point the frontend proxy at it (`VITE_DEV_API_PROXY=http://localhost:5000`). The API defaults to port 4000 for local development without Google.
Tests (no external MongoDB required — uses mongodb-memory-server): `cd server && npm test`

## Roles
- **superadmin** — all libraries, `/api/admin/*` (create/disable libraries, add client admins, metrics). Opens a library via `X-Library-Id` (optionally `X-Read-Only: 1`).
- **client_admin** — exactly one library; all data routes are filtered by the account's `tenantId` (request-supplied `tenantId`/`libraryId` is ignored).
- **staff** — login linked to a staff record inside one library; the existing granular staff permissions apply in the UI.

## Env vars
Render (backend): `MONGODB_URI`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGIN`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (optional), `DEFAULT_TENANT_ID`/`DEFAULT_TENANT_NAME` (migration only), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `FRONTEND_URL`, `NODE_ENV` (`PORT` is set by Render).
Vercel (frontend): `VITE_API_URL` only (e.g. `https://lms-api.onrender.com`). `VITE_GOOGLE_CLIENT_ID` is no longer used — Google is configured entirely on the backend.

## Google sign-in
Create an OAuth 2.0 **Web** client in Google Cloud Console.

Registered **redirect URIs**:
- Local: `http://localhost:5000/api/auth/google/callback`
- Production: `https://lms-api-sz2z.onrender.com/api/auth/google/callback`

Registered **JavaScript origins** (not required by the server-side flow, but keep them registered):
- `http://localhost:5173`
- `https://library-os-app.vercel.app`

Backend env:
- `GOOGLE_CLIENT_ID` — OAuth client ID
- `GOOGLE_CLIENT_SECRET` — OAuth client secret (server-side only, never commit it)
- `GOOGLE_CALLBACK_URL` — must exactly match a registered redirect URI above
- `FRONTEND_URL` — `https://library-os-app.vercel.app` in production, `http://localhost:3001` locally

Flow:
1. The login page links to `GET /api/auth/google/start`.
2. The API generates a random `state` and a PKCE `code_verifier`, stores them together in a short-lived HttpOnly `lms_g_oauth` cookie, and redirects to Google.
3. Google redirects back to `GET /api/auth/google/callback`; the API verifies the state against the cookie and exchanges the code with the PKCE verifier.
4. The Google ID token must contain a verified email (`email_verified === true`).
5. The email is matched to an existing pre-provisioned user. Unknown emails are rejected — there is no self-signup and Google never grants roles. Existing accounts get their `googleSub` linked on first sign-in.
6. The normal app JWT is passed to the frontend in the URL fragment (`#google_token=…`) and is removed from the address bar immediately. Errors use `#google_error=<code>` and are mapped to friendly messages.

Only pre-provisioned, active emails can sign in; disabled accounts and disabled libraries are rejected.

## MongoDB Atlas
Atlas → Network Access must allow Render's outbound IPs (or `0.0.0.0/0`).

## Current deployment
- App (Vercel project `library-os-app`): https://library-os-app.vercel.app — env `VITE_API_URL`
- Landing (Vercel project `library-os`, from `landing/`): https://library-os-ashy.vercel.app — env `VITE_APP_URL`, `VITE_SITE_URL`
- API (Render `lms-api`, Singapore, free): https://lms-api-sz2z.onrender.com — `GET /health`
- Vercel projects are deployed with the CLI (not Git-linked yet: the Vercel account needs a GitHub login connection first).
- The free Render instance sleeps when idle; the first request after a while can take ~30-60 s.
