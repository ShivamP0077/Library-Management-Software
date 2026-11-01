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
Tests (need any MongoDB): `cd server && MONGODB_URI_TEST=mongodb://127.0.0.1:27017 npm test`

## Roles
- **superadmin** — all libraries, `/api/admin/*` (create/disable libraries, add client admins, metrics). Opens a library via `X-Library-Id` (optionally `X-Read-Only: 1`).
- **client_admin** — exactly one library; all data routes are filtered by the account's `libraryId` (request-supplied `libraryId` is ignored).
- **staff** — login linked to a staff record inside one library; the existing granular staff permissions apply in the UI.

## Env vars
Render (backend): `MONGODB_URI`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_DB`, `JWT_SECRET`, `CORS_ORIGIN`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` (optional), `GOOGLE_CLIENT_ID`, `NODE_ENV`, (`PORT` is set by Render).
Vercel (frontend): `VITE_API_URL` (e.g. `https://lms-api.onrender.com`), `VITE_GOOGLE_CLIENT_ID`.

## Google sign-in
Create an OAuth 2.0 Web client in Google Cloud Console. Authorized JavaScript origins:
`http://localhost:3001`, `http://127.0.0.1:3001`, and the Vercel URL (e.g. `https://<project>.vercel.app` + any custom domain).
Only pre-provisioned emails can sign in (no self-signup).

## MongoDB Atlas
Atlas → Network Access must allow Render's outbound IPs (or `0.0.0.0/0`).

## Current deployment
- App (Vercel project `library-os-app`): https://library-os-app.vercel.app — env `VITE_API_URL`
- Landing (Vercel project `library-os`, from `landing/`): https://library-os-ashy.vercel.app — env `VITE_APP_URL`, `VITE_SITE_URL`
- API (Render `lms-api`, Singapore, free): https://lms-api-sz2z.onrender.com — `GET /health`
- Vercel projects are deployed with the CLI (not Git-linked yet: the Vercel account needs a GitHub login connection first).
- The free Render instance sleeps when idle; the first request after a while can take ~30-60 s.
