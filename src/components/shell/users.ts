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
