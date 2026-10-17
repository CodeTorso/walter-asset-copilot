// Prints oracle numbers straight from the raw files. Usage: bun run oracle <dataset folder>
import { downtimeDays, latestProducing, loadRaw, realSpills, spillGrid } from "../src/server/oracle/oracle"

const raw = loadRaw(process.argv[2] ?? "RESOURCE/flytbase-ahc-swe-asset-intelligence-dataset/sample-data")
const th = { T200: 15, T350: 20 }
const lp = latestProducing(raw, th)
console.log("today", raw.today, "wells", raw.wells.length, "not producing now", Object.values(lp).filter((v) => !v).length)
const dt = downtimeDays(raw, th, "2026-06-16", raw.today)
console.log("top downtime", Object.entries(dt).sort((a, b) => b[1] - a[1]).slice(0, 5))
console.log("2026 spills", realSpills(raw, "2026-01-01", "2026-12-31").length, spillGrid(raw, 2026))
