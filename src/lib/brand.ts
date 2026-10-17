// Single source for the product name, assistant persona and worker roster. Rename here only.
import type { WorkerId } from "@/contracts"

export const APP_NAME = "Walter"
export const APP_TAGLINE = "One chat for every well, spill and repair."
export const ASSISTANT_NAME = "Walter"
export const ASSISTANT_ROLE = "Field operations assistant"

export type WorkerProfile = { id: WorkerId; name: string; role: string; blurb: string }

/** Display order in the rail. The server writes delegation lines using these names. */
export const WORKERS: WorkerProfile[] = [
  { id: "field", name: "Tess", role: "Field status", blurb: "Readings, producing status, downtime and spills." },
  { id: "maintenance", name: "Marco", role: "Maintenance and costs", blurb: "Repairs, costs and root-cause checks." },
  { id: "compliance", name: "Ines", role: "Compliance and documents", blurb: "SOP and manual rules, regulator events, report facts." },
  { id: "memory", name: "Juno", role: "Memory and notes", blurb: "Corrections, shared notes, claims and your past chats." },
]
export const WORKER_BY_ID = Object.fromEntries(WORKERS.map((w) => [w.id, w])) as Record<WorkerId, WorkerProfile>
