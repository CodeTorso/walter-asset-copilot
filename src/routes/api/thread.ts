import { createFileRoute } from "@tanstack/react-router"
import { getDatasets, getOrCreateUserThread, listMessages } from "@/server"

// The user's single thread with Walter (text and finding references, oldest first).
export const Route = createFileRoute("/api/thread")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const userId = url.searchParams.get("userId")
        if (!userId) return Response.json({ error: "userId required" }, { status: 400 })
        const datasetId = url.searchParams.get("dataset") ?? (await getDatasets())[0]?.id
        if (!datasetId) return Response.json({ messages: [] })
        const thread = await getOrCreateUserThread(datasetId, userId)
        const messages = await listMessages(thread.id, 200)
        return Response.json({ threadId: thread.id, datasetId, messages })
      },
    },
  },
})
