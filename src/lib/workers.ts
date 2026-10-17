import type { WorkerId, WorkerState } from "@/contracts"

// Placeholder names/roles (user may rename). Avatars are resolved by the shell; `avatar` is a seed string.
export const WORKER_DEFS: Record<WorkerId, Pick<WorkerState, "id" | "name" | "role" | "avatar">> = {
  field: { id: "field", name: "Tess", role: "Field status: readings, producing status, downtime, spills", avatar: "tess" },
  maintenance: { id: "maintenance", name: "Marco", role: "Maintenance: repairs, costs, root-cause checks", avatar: "marco" },
  compliance: { id: "compliance", name: "Ines", role: "Compliance and documents: rules, regulator events, reports", avatar: "ines" },
  memory: { id: "memory", name: "Juno", role: "Memory and notes: corrections, shared notes, past chats", avatar: "juno" },
}
export const WORKER_ORDER: WorkerId[] = ["field", "maintenance", "compliance", "memory"]
export const initialWorkers = (): Record<WorkerId, WorkerState> =>
  Object.fromEntries(WORKER_ORDER.map((id) => [id, { ...WORKER_DEFS[id], status: "idle", progress: [] } satisfies WorkerState])) as unknown as Record<WorkerId, WorkerState>
