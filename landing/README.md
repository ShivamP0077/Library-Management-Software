# Library OS — marketing landing page

Standalone Vite + React + Tailwind site with a three.js (@react-three/fiber + drei) hero and framer-motion scroll animations.

```bash
npm install
npm run dev       # local dev
npm run build     # outputs to dist/
npm run preview   # serve the build
```

## Env vars (see .env.example)
| Var | Default | Purpose |
|---|---|---|
| `VITE_APP_URL` | `/app` | Target of "Start free trial" / "Sign in" buttons (the deployed app URL) |
| `VITE_DEMO_EMAIL` | `mylibraryosadmin@gmail.com` | Support address for the footer and legal/contact mailto links. Book a demo is the form at `/demo`, not a mailto. |
| `VITE_SITE_URL` | `https://mylibraryos.in` | Absolute site URL used for canonical + og:image tags |
| `VITE_API_URL` | unset | API origin for live software-plan prices (`/api/public/software-plans`) and the public demo form (`/api/public/demo-requests`). If unset, pricing says prices are unavailable and the demo form says it is unavailable. |

## Deploy (Vercel)
Set the project Root Directory to `landing`; framework Vite, build `npm run build`, output `dist` (also in `vercel.json`).

Pricing loads live plans from `VITE_API_URL`. The Custom card stays a sales card. Book a demo and Contact sales open `/demo`. The footer and legal pages still mailto `VITE_DEMO_EMAIL`.
