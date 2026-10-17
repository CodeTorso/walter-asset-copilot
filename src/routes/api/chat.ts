import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { runTurn, type Part } from "@/agent/turn"

const Body = z.object({
  userId: z.string().min(1),
  text: z.string().min(1).max(4000),
  datasetId: z.string().optional(),
})

// Streams one turn as newline-delimited JSON parts. Aborting the request cancels the model call.
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return Response.json({ error: parsed.error.flatten() }, { status: 400 })
        const { userId, text, datasetId } = parsed.data
        const encoder = new TextEncoder()
        let turn: { turnId: string; conversationId: string; datasetId: string } | null = null

        const stream = new ReadableStream({
          async start(controller) {
            const emit = (p: Part) => {
              if (p.type === "data-turn" && p.data.phase === "started") turn = p.data
              try {
                controller.enqueue(encoder.encode(JSON.stringify(p) + "\n"))
              } catch {
                // client went away
              }
            }
            try {
              await runTurn({ userId, text, datasetId, signal: request.signal, emit })
            } catch (e) {
              const phase = request.signal.aborted ? "cancelled" : "failed"
              console.error("[chat] turn", phase, e instanceof Error ? e.message : e)
              if (turn) emit({ type: "data-turn", data: { ...turn, userId, phase } })
            } finally {
              try {
                controller.close()
              } catch {}
            }
          },
        })
        return new Response(stream, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
        })
      },
    },
  },
})
