# Library OS — Handover

For **Omdev** (omdevsinhmakwana9898@gmail.com, owner of the upstream repo).
This covers running the stack locally, configuring it, verifying it, and redeploying it. The last section is for your coding agent.

> **No real secrets are in this file.** Ask Shivam for passwords, or read them from the Render / Atlas dashboards.

---

## 0. What's in the repo

| Part | Folder | Stack | Local port |
|---|---|---|---|
| App (staff/admin UI) | `/` (repo root) | React 18 + Vite 5 | **3001** |
| API | `/server` | Node 20 + Express 5 + Mongoose 9 (MongoDB Atlas) | **4000** |
| Landing (marketing site) | `/landing` | React 18 + Vite 5 + Tailwind + three.js | **5173** (Vite default) |

Prerequisites: **Node.js 20+** (Render runs 20; `server/package.json` needs ≥18), npm, git, and a MongoDB you can reach (Atlas Cluster0, or a local `mongod` for tests).

---

## 1. Get the code (pick the right branch)

### A) Before PR #2 is merged
PR: https://github.com/omdevsinhmakwana9898-ai/Library-Management-Software/pull/2

Option 1 — clone the fork branch directly:
```bash
git clone -b backend-atlas https://github.com/ShivamP0077/Library-Management-Software.git library-os
cd library-os
```

Option 2 — from your own upstream clone, fetch the PR head:
```bash
git clone https://github.com/omdevsinhmakwana9898-ai/Library-Management-Software.git library-os
cd library-os
git fetch origin pull/2/head:backend-atlas
git checkout backend-atlas
```

### B) After PR #2 is merged
```bash
git clone https://github.com/omdevsinhmakwana9898-ai/Library-Management-Software.git library-os
cd library-os            # you are on main
```

## 2. Pull the latest changes

| You set it up via | Update with |
|---|---|
| A1 (fork clone) | `git pull origin backend-atlas` |
| A2 (PR ref) | `git checkout main && git fetch origin pull/2/head:backend-atlas --force && git checkout backend-atlas` (you can't force-fetch into the branch you're on) |
| B (merged) | `git checkout main && git pull origin main` |

After merging, if you used A2, switch over: `git checkout main && git pull && git branch -D backend-atlas`.

After pulling, re-run `npm install` in each part whose `package-lock.json` changed (root, `server/`, `landing/`).

---

## 3. Backend (`/server`)

```bash
cd server
cp .env.example .env        # then fill it in (see §6)
npm install
npm run dev                 # node --watch src/index.js  → http://localhost:4000
# or: npm start             # node src/index.js (no watch)
```

- Listens on `PORT` (default **4000**) on `0.0.0.0`. It starts serving right away and retries the MongoDB connection every `DB_RETRY_MS` (default 30 s) until it connects.
- **Super admin seeding happens automatically on startup.** Once connected, `ensureSuperAdmin()` creates the user `SUPERADMIN_EMAIL` (default `omdevsinhmakwana9898@gmail.com`) **only if no user with that email exists**. The password is `SUPERADMIN_PASSWORD`. If that's empty and `SUPERADMIN_CREDENTIALS_FILE` is set, a strong password is generated and written to that file (mode 600). If both are empty, the account can only sign in with Google. If the user already exists (it does in the live Atlas DB), nothing changes.
- Manual seeding:
  - `npm run seed` — super admin only.
  - `npm run seed:demo` — super admin plus a demo library `DEMO_LIBRARY_ID` (default `lib-demo`) with client admin `DEMO_ADMIN_EMAIL`. Credentials go to `DEMO_CREDENTIALS_FILE` if set. It's idempotent and skips the demo if that library already exists.
  - ⚠️ If `server/.env` points at the **live** Atlas DB, seeding writes to production.
- **Tests** (11 integration tests: role hierarchy and tenant isolation). Each run uses a throwaway database `lms_test_<timestamp>` and drops it afterwards:
  ```bash
  cd server
  MONGODB_URI_TEST=mongodb://127.0.0.1:27017 npm test      # local mongod (recommended)
  # Atlas also works: MONGODB_URI_TEST='mongodb+srv://<user>:<password>@cluster0.cpc9qd2.mongodb.net' npm test
  ```
  No local MongoDB? Use `docker run -d -p 27017:27017 mongo:7`.

## 4. Frontend app (repo root)

```bash
# from the repo root
npm install
npm run dev                 # vite → http://localhost:3001 (opens a browser; set NO_OPEN=1 to skip)
npm run build               # → dist/
npm run preview             # serve dist/ locally
```

- **Local proxy:** with `VITE_API_URL` unset, the app calls `/api/...` and Vite proxies `/api` and `/health` to `http://localhost:4000`. Set `VITE_DEV_API_PROXY` to proxy somewhere else, e.g. the live Render API.
- With `VITE_API_URL` set (e.g. `https://lms-api-sz2z.onrender.com`), the app calls that origin directly. The backend's `CORS_ORIGIN` must then include `http://localhost:3001`.
- Start the backend first. Without it the app shows the login screen, but sign-in fails.

## 5. Landing (`/landing`)

```bash
cd landing
npm install
npm run dev                 # → http://localhost:5173
npm run build               # → landing/dist
npm run preview             # → http://localhost:4173
```
Its CTAs ("Sign in", "Start free trial", "Sign in with Google") link to `VITE_APP_URL`. For local testing, set it to `http://localhost:3001`.

---

## 6. Environment variables (every one the code reads)

Files (all git-ignored, never commit them):
- **`server/.env`** — backend. Template: `server/.env.example`. Loaded by `dotenv`; real environment variables take precedence.
- **`.env.local`** in the repo root — app. Template: `.env.example`. Vite only exposes `VITE_*` to the browser.
- **`landing/.env.local`** — landing. Template: `landing/.env.example`.

Vite bakes `VITE_*` values into the bundle at **build** time, so restart `npm run dev` after editing, and redeploy after changing them on Vercel.

### Backend — `server/.env`

| Var | Required | Default | What it does | Where to get it |
|---|---|---|---|---|
| `MONGODB_URI` | **yes** | — | MongoDB connection string. Credentials can be in the URI or come from the two vars below. For `mongodb+srv://` URIs, the server falls back to DNS-over-HTTPS if your DNS can't resolve SRV records. | Atlas → Cluster0 → **Connect → Drivers**. Format: `mongodb+srv://<user>:<password>@cluster0.cpc9qd2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0` (just `mongodb+srv://cluster0.cpc9qd2.mongodb.net` also works with the two vars below) |
| `MONGODB_USERNAME` | optional | — | Added to the URI if the URI has no credentials (ignored for localhost URIs) | Atlas → Database Access |
| `MONGODB_PASSWORD` | optional | — | Same as above | Atlas → Database Access (ask Shivam, or reset it there) |
| `MONGODB_DB` | optional | `library_management` | Database name. Use `library_management` to see the live data. | — |
| `PORT` | optional | `4000` | HTTP port (Render sets it automatically) | — |
| `NODE_ENV` | optional | — | `production` makes `JWT_SECRET` mandatory; `test` turns off request logging | — |
| `JWT_SECRET` | **yes in production**; recommended locally | `dev-insecure-secret-change-me` (only when not in production) | Signs the app's login tokens (JWTs). Tokens only work on a server with the **same** secret. Locally, just generate your own; you only need Render's value if you want tokens to work across both servers. | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (or `openssl rand -hex 48`) |
| `JWT_EXPIRES_IN` | optional | `12h` | How long a login token stays valid | — |
| `CORS_ORIGIN` | optional | `*` (any origin) | Comma-separated list of allowed browser origins | Local: `http://localhost:3001,http://localhost:5173`. Render: `https://library-os-app.vercel.app,https://library-os-ashy.vercel.app,http://localhost:3001` |
| `SUPERADMIN_EMAIL` | optional | `omdevsinhmakwana9898@gmail.com` | Super admin created at startup if missing | — |
| `SUPERADMIN_PASSWORD` | optional | — | Password login for the super admin, applied **only when the user is first created** | Your choice (≥ 8 characters). For the existing live account, ask Shivam. |
| `SUPERADMIN_CREDENTIALS_FILE` | optional | — | Where a generated super admin password is written (and reused) if `SUPERADMIN_PASSWORD` is empty | A local path outside the repo, e.g. `~/.library-os/superadmin.txt` |
| `GOOGLE_CLIENT_ID` | optional | — (Google login off) | OAuth Web client ID used to check Google sign-in tokens (comma-separated list allowed) | See *Google sign-in* below |
| `DEMO_LIBRARY_ID` | optional | `lib-demo` | Library ID used by `npm run seed:demo` | — |
| `DEMO_ADMIN_EMAIL` | optional | `demo.admin@example.com` | Demo client admin created by `seed:demo` | — |
| `DEMO_CREDENTIALS_FILE` | optional | — | Where `seed:demo` writes the generated demo admin password | A local path outside the repo |
| `DB_RETRY_MS` | optional | `30000` | How long to wait between MongoDB connection retries | — |
| `JSON_LIMIT` | optional | `25mb` | Max JSON request size (document scans are sent as base64) | — |
| `SERVE_FRONTEND` | optional | off | `true` makes the API also serve the built app from `../dist` (single-host setup) | — |
| `MONGODB_URI_TEST` | tests only | `mongodb://127.0.0.1:27017` | MongoDB used by `npm test` (pass it on the command line) | — |

Minimal `server/.env` for local dev against the live Atlas data:
```dotenv
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.cpc9qd2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
MONGODB_DB=library_management
PORT=4000
JWT_SECRET=<generate one>
CORS_ORIGIN=http://localhost:3001,http://localhost:5173
SUPERADMIN_EMAIL=omdevsinhmakwana9898@gmail.com
GOOGLE_CLIENT_ID=
```

### App — root `.env.local`

| Var | Required | Default | What it does | Where to get it |
|---|---|---|---|---|
| `VITE_API_URL` | optional locally, **required on Vercel** | empty, so it uses `/api` through the Vite proxy | Backend origin; `/api` is added automatically | Local: leave empty. Production: `https://lms-api-sz2z.onrender.com` |
| `VITE_GOOGLE_CLIENT_ID` | optional | empty (no Google button) | Shows the "Sign in with Google" button | Same value as the backend's `GOOGLE_CLIENT_ID` |
| `VITE_DEV_API_PROXY` | optional (dev only, read by `vite.config.js`) | `http://localhost:4000` | Where the dev server proxies `/api` and `/health` | e.g. `https://lms-api-sz2z.onrender.com` to use the live API from the local UI |
| `NO_OPEN` / `CI` | optional (dev only) | — | Any value stops `npm run dev` from opening a browser | — |

### Landing — `landing/.env.local`

| Var | Required | Default | What it does | Where to get it |
|---|---|---|---|---|
| `VITE_APP_URL` | recommended | `/app` | Target of the Sign in / Start free trial buttons | Local: `http://localhost:3001`. Production: `https://library-os-app.vercel.app` |
| `VITE_SITE_URL` | recommended for production | empty | The landing's own public URL, used for canonical and social-preview tags at build time | Production: `https://library-os-ashy.vercel.app` (or your custom domain) |
| `VITE_DEMO_EMAIL` | optional | `hello@example.com` (placeholder) | Address for the "Book a demo" mailto link | Your sales/support email |

### Google sign-in (not set up yet)
1. Google Cloud Console → APIs & Services → **OAuth consent screen**: set it up (External, app name, support email). While testing, add test users.
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorized JavaScript origins** (no paths, no trailing slash):
   - `http://localhost:3001`
   - `http://127.0.0.1:3001`
   - `https://library-os-app.vercel.app`
   - plus any custom domain you add later
   No redirect URIs are needed; the app uses Google Identity Services' ID-token (popup) flow.
4. Put the client ID in `GOOGLE_CLIENT_ID` (backend / Render) **and** `VITE_GOOGLE_CLIENT_ID` (app / Vercel), then restart or redeploy both.
5. Only emails that already have a user record can sign in (super admin, client admins added by the super admin, staff added by client admins). Anyone else gets a 403, and there's no self-signup. The Google email must be verified.

---

## 7. Verify locally

1. Backend health:
   ```bash
   curl http://localhost:4000/health        # always 200; "ok":true once MongoDB is connected
   curl http://localhost:4000/api/health    # 503 until the DB is connected
   ```
   Expected: `{"ok":true,"db":{"state":"connected","name":"library_management","collections":[...]},"googleAuth":false}`
2. Open http://localhost:3001 → login screen.
3. Sign in as super admin **omdevsinhmakwana9898@gmail.com**. The password isn't in this doc; **ask Shivam** (or use Google once configured).
4. The super admin overview should list **Demo Study Library** (`lib-demo`) and **blue lagoon** (`lib-blue-lagoon`, 25 seats), with totals at the top. These live in the **live Atlas DB**, so you see them only when your local backend uses the same `MONGODB_URI` + `MONGODB_DB=library_management`. A fresh or local database starts empty apart from your super admin.
5. Click **Manage** (or the eye icon for read-only) on a library to open its workspace. **← All libraries** goes back.
6. Run the tests (§3).

Careful: a local backend pointed at the live DB **is production data**.

---

## 8. Deployment reference

### Render — API
- Service **`lms-api`** → https://lms-api-sz2z.onrender.com (health check `/health`). Free plan, Singapore region.
- Built from repo `ShivamP0077/Library-Management-Software`, branch `backend-atlas`, root dir `server`; build `npm install`, start `npm start`. Auto-deploy is on, so a push to that branch redeploys.
- Blueprint: `render.yaml` in the repo root (for recreating it as a Blueprint).
- Env var names set on Render: `MONGODB_URI`, `MONGODB_USERNAME`, `MONGODB_PASSWORD`, `MONGODB_DB`, `JWT_SECRET`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `NODE_ENV`, `CORS_ORIGIN`, `GOOGLE_CLIENT_ID` (empty), `NODE_VERSION`.
- After PR #2 merges, change the service's branch to `main` on the upstream repo (Render dashboard → Settings → Build & Deploy; connect GitHub if needed).
- Manual redeploy: Render dashboard → **Manual Deploy → Deploy latest commit**, or the Render API `POST https://api.render.com/v1/services/<service-id>/deploys` with your API key. Changing env vars requires a redeploy or restart.

### Vercel — app and landing
| Project | URL | Root | Env vars |
|---|---|---|---|
| `library-os-app` | https://library-os-app.vercel.app | repo root | `VITE_API_URL`, later `VITE_GOOGLE_CLIENT_ID` |
| `library-os` (landing) | https://library-os-ashy.vercel.app | `landing/` | `VITE_APP_URL`, `VITE_SITE_URL`, optional `VITE_DEMO_EMAIL` |

- Both are currently **CLI deployments and are not linked to GitHub** (the Vercel account has no GitHub login connection). To get deploy-on-push: Vercel → Account Settings → Authentication/Login Connections → connect GitHub, then Project → Settings → Git → connect the repo. For the landing, set Root Directory to `landing`.
- Redeploy with the CLI (needs `npx vercel login` or a token):
  ```bash
  # app (repo root; .vercelignore excludes server/ and landing/)
  npx vercel link --project library-os-app     # once
  npx vercel deploy --prod
  # landing
  cd landing && npx vercel link --project library-os && npx vercel deploy --prod
  ```
  If `vercel link` at the repo root complains about detected "services" (it sees `server/`), deploy from a copy of the repo without `server/` and `landing/`, or link the project to GitHub instead. That's what was done for the current deploys.
- After changing any `VITE_*` var on Vercel, **redeploy** (they're applied at build time).
- When you add a custom domain: add it to `CORS_ORIGIN` on Render, to the Google OAuth origins, and to `VITE_SITE_URL` / `VITE_APP_URL` for the landing.

---

## 9. Notes and known TODOs

- **Render free tier sleeps** after ~15 minutes idle. The first request then takes 30–60 s, so the app's first login can look stuck.
- **Atlas Network Access** must allow the machine running the backend: your IP for local dev, and `0.0.0.0/0` for Render (its free tier has no fixed outbound IP). Without that you get "Could not connect to any servers… IP that isn't whitelisted".
- (The build machine Shivam used couldn't reach port 27017. That's irrelevant for your setup.)
- TODOs:
  - Create the Google OAuth client and set `GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_ID`.
  - Landing pricing is a placeholder (`₹ —`) and `VITE_DEMO_EMAIL` is a placeholder.
  - The demo client admin uses the placeholder email `demo.admin@example.com`. Replace it or disable the demo library before real launch.
  - Granular staff permissions (`src/utils/staffPermissions.js`) are enforced only in the UI. The server enforces tenant and role (superadmin / client_admin / staff). Server-side per-module checks would be a follow-up.
  - A newly created library opens on the **Setup Wizard** (branches, sections, seat types, seats, shifts, plans). Its header name stays blank until the wizard is completed.
  - The Vercel projects aren't Git-linked yet, and Render still builds from the fork branch (see §8).

---

## 10. For your coding agent

### Architecture map
```
/                         React app (Vite). Entry: index.html → src/main.jsx → src/App.jsx
  src/App.jsx             AuthProvider → RoleRouter: LoginScreen | SuperAdminDashboard | LibraryWorkspace
  src/auth/               AuthContext.jsx (session, per-library localStorage cache), LoginScreen.jsx (password + GIS button),
                          SuperAdminDashboard.jsx (libraries + metrics, create/disable, add admins, drill-in)
  src/context/LibraryContext.jsx   ALL domain state + business logic (admissions, renewals, seat allocation, payments,
                          expenses, staff, waiting list). Loads from GET /api/state on mount, then debounced bulk sync
                          PUT /api/<collection> on every state change. Props: readOnly, lockedStaffId.
  src/utils/api.js        API client: base URL (VITE_API_URL or /api), Bearer token, X-Library-Id / X-Read-Only for super admin drill-in,
                          createSyncQueue (change-detecting debounced sync)
  src/utils/idbStorage.js document scans: IndexedDB cache + /api/documents/:key
  src/utils/staffPermissions.js, scopeResolver.js, pricingCalculator.js, shiftUtils.js, dateUtils.js, splitPaymentUtils.js
  src/components/         Dashboard, StudentManager, SeatMap, PaymentManager, ExpenseManager, ReportsManager, LibrarySettings,
                          SetupWizard, Header (desktop tabs + mobile drawer/bottom nav), Modals/*
  src/responsive.css      mobile/tablet layer; src/utils/responsiveTables.js labels table cells for mobile card layout
  vite.config.js          dev server :3001, proxy /api + /health → :4000
  vercel.json, .vercelignore
/server                   Express API
  src/index.js            boot: listen first, connect DB with retry, ensureSuperAdmin()
  src/app.js              createApp(): CORS, JSON limit, /health, /api router, error handler
  src/db.js               URI building, SRV→DoH fallback, connectDB()
  src/models.js           Library, User, Settings, StudentDocument, tenant collections (COLLECTIONS map)
  src/auth.js             JWT sign/verify, requireAuth (re-checks user+library status in DB), requireRole, tenantScope
  src/routes.js           all routes (auth, admin, tenant)
  src/services.js         createLibrary, createUser, computeMetrics, password helpers
  src/google.js           Google ID-token verification
  src/seed.js, seed-cli.js  super admin / demo seeding
  test/tenancy.test.js    node:test integration tests
  render.yaml (repo root) Render blueprint
/landing                  marketing site (src/components/*, src/config.js reads VITE_APP_URL / VITE_DEMO_EMAIL)
```

### Models (MongoDB, database `library_management`)
- `libraries`: `{ libraryId (unique), name, status: Active|Disabled, contactEmail, createdBy }`
- `users`: `{ email (unique), name, passwordHash?, role: superadmin|client_admin|staff, libraryId (required unless superadmin), staffId?, status, googleSub?, authProviders[], lastLoginAt }`
- `settings`: one per `libraryId`. This is the UI's settings object.
- Tenant collections, each doc `{ libraryId, _key, _order, ...UI fields }` with a unique `{libraryId,_key}` index. `_key` is the UI's `id` (payments: `receiptNo`):
  `students, archivedstudents, payments, expenses, staffs (staffMembers), branches, sections, seattypes, seats, shifts, plans, waitinglistentries`
- `studentdocuments`: `{ libraryId, storageKey, data (base64) }`

### API (all JSON; `Authorization: Bearer <jwt>` except where noted)
- Public: `GET /health`, `GET /api/health`, `GET /api/auth/config`, `POST /api/auth/login {email,password}`, `POST /api/auth/google {credential}` → `{token,user,library}`
- Any signed-in user: `GET /api/auth/me`, `POST /api/auth/change-password`
- Super admin (`/api/admin`): `GET/POST /libraries`, `PATCH /libraries/:libraryId {name,status,contactEmail}`, `GET /metrics`, `GET/POST /libraries/:libraryId/users`, `PATCH /users/:id`
- Per library (client_admin/staff: own library; superadmin: `X-Library-Id` header, optionally `X-Read-Only: 1`):
  `GET /api/state` (everything), `GET/PUT /api/settings`, `GET/PUT/DELETE /api/documents/:key`,
  `GET/POST /api/users`, `PATCH /api/users/:id` (client_admin/superadmin),
  `GET /api/:collection[?branchId&status&studentId]`, `POST /api/:collection`, `PUT /api/:collection` (bulk sync: upsert the array, delete this library's missing docs),
  `GET/PUT/DELETE /api/:collection/:key`. `:collection` ∈ `students, archivedStudents, payments, expenses, staffMembers, branches, sections, seatTypes, seats, shifts, plans, waitingList`.

### Tenancy rules (don't break these)
1. A client user's tenant comes **only** from their `User.libraryId` (looked up from the DB on every request). Never trust `libraryId` from the body, query or headers. `stripMeta()` removes it from input, and writes force `libraryId = req.libraryId`.
2. Every tenant query must filter by `libraryId: req.libraryId`; every bulk delete must be limited to that library.
3. Only a superadmin may use `X-Library-Id`. `X-Read-Only: 1` must block non-GET requests.
4. Disabled users or libraries lose access immediately (checked in `requireAuth`).
5. No self-signup: Google login only maps to existing users.
6. Add a test to `server/test/tenancy.test.js` for any new tenant-scoped route.

### Conventions
- The UI owns entity shapes (schemas are `strict: false`). Add new UI state to `SYNCED_COLLECTIONS` (`src/utils/api.js`), to `COLLECTIONS` (`server/src/models.js`), and to the hydrate/sync effects in `LibraryContext.jsx`.
- Secrets live only in `server/.env` / `.env.local` files (git-ignored) and in the Render/Vercel dashboards.
