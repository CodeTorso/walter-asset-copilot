import { useMemo } from "react"
import { useBootstrap, type BootUser } from "@/lib/stores/bootstrap"

export type { BootUser }
export const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
export const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2)
export const firstName = (n: string) => n.split(" ")[0]

export function useUsers() {
  return useBootstrap((s) => s.users)
}
export function useUserNames() {
  const users = useUsers()
  return useMemo(() => Object.fromEntries(users.map((u) => [u.userId, u.name])) as Record<string, string>, [users])
}

// The picker offers four people, named after the Hack Day organisers (credit), each standing in for a
// dataset user of a different role so memory and corrections still belong to a real record.
export const CREDITS: { userId: string; name: string }[] = [
  { userId: "U-201", name: "Harshad Sheelwant" },
  { userId: "U-202", name: "Aryan Patel" },
  { userId: "U-301", name: "Mahesh Mali" },
  { userId: "U-401", name: "Ankita Divekar" },
]
export function usePickerUsers() {
  const users = useUsers()
  const datasetId = useBootstrap((s) => s.datasetId)
  return useMemo(() => {
    if (datasetId && datasetId !== "sample") {
      const byRole = new Map<string, BootUser>()
      for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u)
      return [...byRole.values()].slice(0, CREDITS.length)
    }
    const picked = CREDITS.map((c) => users.find((u) => u.userId === c.userId)).filter((u): u is BootUser => !!u)
    if (picked.length < CREDITS.length) {
      // Another dataset: the first users of distinct roles stand in instead.
      const byRole = new Map<string, BootUser>()
      for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u)
      picked.splice(0, picked.length, ...[...byRole.values()].slice(0, CREDITS.length))
    }
    return picked.map((u, i) => ({ ...u, name: CREDITS[i]!.name }))
  }, [users, datasetId])
}
