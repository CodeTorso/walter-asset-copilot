import fleet from "@/fixtures/fleet.json"

export type AppUser = { user_id: string; name: string; role: string; team_id: string | null }
export const USERS = (fleet as { users: AppUser[] }).users
export const USER_NAMES: Record<string, string> = Object.fromEntries(USERS.map((u) => [u.user_id, u.name]))
export const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
export const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2)
export const firstName = (n: string) => n.split(" ")[0]
