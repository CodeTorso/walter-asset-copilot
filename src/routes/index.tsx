import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/shell/AppShell"

export const Route = createFileRoute("/")({
  component: AppShell,
  head: () => ({ meta: [{ title: "Walter · Field operations" }] }),
})
