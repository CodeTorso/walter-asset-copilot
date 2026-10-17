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

// The picker offers three people with different roles; everyone else still resolves by name.
const PICKER_PREFERRED = ["U-201", "U-202", "U-401"]
export function usePickerUsers() {
  const users = useUsers()
  return useMemo(() => {
    const preferred = PICKER_PREFERRED.map((id) => users.find((u) => u.userId === id)).filter((u): u is BootUser => !!u)
    if (preferred.length === 3) return preferred
    const byRole = new Map<string, BootUser>()
    for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u)
    return [...byRole.values()].slice(0, 3)
  }, [users])
}
