// Shell bootstrap: dataset, users, areas and wells from GET /api/bootstrap, with fixture fallback.
import { create } from "zustand"
import fleet from "@/fixtures/fleet.json"

export type BootUser = { userId: string; name: string; role: string; teamId: string | null }
export type BootWell = {
  wellId: string
  name: string
  wellType: string
  areaId: string
  areaName: string
  lat: number
  lon: number
  recordedStatus: string
  producing: boolean | null
  deltaC: number | null
  lastInspectedAt: string | null
}
export type BootArea = { areaId: string; name: string; teamId?: string; center: { lat: number; lon: number }; wellCount?: number }

type BootState = {
  status: "idle" | "loading" | "live" | "fallback"
  datasetId: string | null
  today: string | null
  users: BootUser[]
  areas: BootArea[]
  wells: BootWell[] | null // null = use the field-map fixture
  load: () => Promise<void>
}

const FALLBACK_USERS: BootUser[] = (fleet as { users: Array<{ user_id: string; name: string; role: string; team_id: string | null }> }).users.map((u) => ({
  userId: u.user_id,
  name: u.name,
  role: u.role,
  teamId: u.team_id,
}))

export const useBootstrap = create<BootState>((set, get) => ({
  status: "idle",
  datasetId: null,
  today: null,
  users: FALLBACK_USERS,
  areas: [],
  wells: null,
  load: async () => {
    if (get().status === "loading" || get().status === "live") return
    set({ status: "loading" })
    try {
      const r = await fetch("/api/bootstrap", { headers: { accept: "application/json" } })
      if (!r.ok) throw new Error(`bootstrap ${r.status}`)
      const j = await r.json()
      if (!Array.isArray(j.users) || !j.users.length) throw new Error("bootstrap: no users")
      const ds = (j.datasets ?? []).find((d: { id: string }) => d.id === j.datasetId)
      set({ status: "live", datasetId: j.datasetId ?? null, today: ds?.today ?? null, users: j.users, areas: j.areas ?? [], wells: j.wells?.length ? j.wells : null })
    } catch (e) {
      console.warn("[bootstrap] falling back to fixtures:", e instanceof Error ? e.message : e)
      set({ status: "fallback" })
    }
  },
}))
