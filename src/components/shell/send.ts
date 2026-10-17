// The one place the UI starts a turn. Today: fixture replay. Later: the live agent transport.
import { simulateTurn } from "@/lib/stores/simulate"
import { useChatStore } from "@/lib/stores/chat"

export function sendMessage(text: string) {
  const t = text.trim()
  if (!t || useChatStore.getState().turn?.phase === "started") return false
  simulateTurn(t)
  return true
}
