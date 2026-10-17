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

## License

MIT
