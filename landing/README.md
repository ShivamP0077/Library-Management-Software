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
| `VITE_DEMO_EMAIL` | `hello@example.com` | "Book a demo" mailto address (placeholder) |
| `VITE_SITE_URL` | empty | Absolute site URL used for canonical + og:image tags |

## Deploy (Vercel)
Set the project Root Directory to `landing`; framework Vite, build `npm run build`, output `dist` (also in `vercel.json`).

Pricing, sample dashboard numbers and the demo email are placeholders.
