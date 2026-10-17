import { createFileRoute } from "@tanstack/react-router"
import { AppShell } from "@/components/shell/AppShell"

export const Route = createFileRoute("/")({
  component: AppShell,
  head: () => ({
    meta: [{ title: "Walter · Field operations" }],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
    ],
  }),
})
