// The one place the UI starts a turn: live /api/chat by default, fixture replay with ?transport=fixture.
import { startTurn } from "@/lib/stores/transport"
import { useChatStore } from "@/lib/stores/chat"

export function sendMessage(text: string) {
  const t = text.trim()
  if (!t || useChatStore.getState().turn?.phase === "started") return false
  startTurn(t)
  return true
}
