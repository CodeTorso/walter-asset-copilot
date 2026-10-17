<img src="assets/icon.svg" width="64" height="64" alt="">

# Asset Intelligence Copilot

A chat copilot that answers oil-field operators' questions about their wells with evidence, inline visuals, shared corrections and private per-user memory. Built for the FlytBase Hack Day (Hacktoberfest 2026) challenge.

## Stack

TanStack Start (React, Vite, Nitro) · Tailwind CSS 4 · shadcn/ui · Motion · Recharts · MapLibre · AI SDK with Gemma 4 · Postgres (PGlite locally, Neon when deployed) · Bun.

## Develop

```bash
bun install
bun run dev        # http://localhost:3000
bun run typecheck
bun run test
```

The challenge dataset is not committed. Clone it from https://github.com/FlytBaseAILabs/flytbase-ahc-swe-asset-intelligence-dataset and point the importer at its `sample-data/` folder.

## Configure

Copy `.env.example` to `.env.local` and fill in at least one model route:

| Variable | What it does |
|---|---|
| `OPENROUTER_API_KEY` | Gemma 4 through OpenRouter, pinned to the 3 fastest tool-capable hosts (recommended) |
| `AI_GATEWAY_API_KEY` | Gemma 4 through the Vercel AI Gateway (on Vercel, OIDC is used automatically) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemma 4 through Google AI Studio, used as a fallback |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Neon Postgres. Leave both empty to use local PGlite in `.data/pglite` |

Walter tries the routes in this order: OpenRouter, Gateway, then AI Studio. `.env.example` lists the optional tuning variables.

## Load data

```bash
bun run ingest --dataset sample --path ../dataset/sample-data          # local PGlite
bun --env-file=.env.local scripts/ingest.ts --dataset sample --path ../dataset/sample-data   # Neon, when DATABASE_URL is set
```

Each dataset is loaded under its own id. The newest one becomes the default, and older ones stay available.

## License

MIT
