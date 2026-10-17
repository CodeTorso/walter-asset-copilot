import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { WalterAvatar } from "@/components/brand/Avatar"
import { useChatStore, type ChatItem } from "@/lib/stores/chat"
import { sendMessage } from "./send"

// A voice call with Walter. Speech is recognised by the browser's speech service (Google-hosted in
// Chrome), sent through the normal chat turn (so cards and citations still land in the thread), and
// Walter's reply is read aloud. No transcript is shown during the call, by design.

type Phase = "connecting" | "listening" | "thinking" | "speaking" | "unsupported" | "blocked" | "error"

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

const recognitionCtor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Walter's words, as they should sound: no citation markers, markdown or tables. */
export function speakable(text: string) {
  return text
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/\$[^$]*\$/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\bWELL-0*(\d+)\b/g, "well $1")
    .replace(/\s+/g, " ")
    .trim()
}

const pickVoice = () => {
  const voices = window.speechSynthesis?.getVoices() ?? []
  return voices.find((v) => /Google UK English Male/i.test(v.name)) ?? voices.find((v) => /Google US English/i.test(v.name)) ?? voices.find((v) => v.lang?.startsWith("en")) ?? null
}

/** Text Walter wrote in the latest turn, once it has finished. */
function latestReply(items: ChatItem[]) {
  let lastUser = -1
  items.forEach((i, k) => i.kind === "user" && (lastUser = k))
  const after = items.slice(lastUser + 1)
  const text = after.filter((i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant").map((i) => i.text).join(" ")
  if (text.trim()) return text
  return after.some((i) => i.kind === "notice") ? "Sorry, I couldn't finish that one. Ask me again." : "Here's what the records show. I've put it in the chat."
}

const PHASE_TEXT: Record<Phase, string> = {
  connecting: "Ringing",
  listening: "Listening",
  thinking: "Checking the records",
  speaking: "Speaking",
  unsupported: "Voice needs Chrome or Edge on this device.",
  blocked: "Microphone access is blocked. Allow it in the address bar, then call again.",
  error: "The line dropped. Hang up and call again.",
}

export function CallOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [muted, setMuted] = useState(false)
  const [secs, setSecs] = useState(0)
  const [phase, setPhase] = useState<Phase>("connecting")
  const reduce = useReducedMotion()
  const rec = useRef<Recognition | null>(null)
  const live = useRef({ open: false, muted: false, phase: "connecting" as Phase })
  live.current.open = open
  live.current.muted = muted
  live.current.phase = phase

  // Start listening (unless muted, busy or closed).
  const listen = () => {
    const L = live.current
    if (!L.open || L.muted || L.phase === "thinking" || L.phase === "speaking") return
    try {
      rec.current?.start()
    } catch {
      // already started
    }
  }

  useEffect(() => {
    if (!open) return
    setSecs(0)
    setMuted(false)
    const Ctor = recognitionCtor()
    if (!Ctor) {
      setPhase("unsupported")
    } else {
      const r = new Ctor()
      r.lang = "en-US"
      r.continuous = false
      r.interimResults = false
      r.onresult = (e) => {
        const res = e.results[e.results.length - 1]
        const said = res?.[0]?.transcript?.trim()
        if (!res?.isFinal || !said) return
        r.stop()
        if (sendMessage(said)) setPhase("thinking")
      }
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setPhase("blocked")
        else if (e.error === "network") setPhase("error")
        // "no-speech" and "aborted" just restart on end
      }
      r.onend = () => {
        if (live.current.phase === "listening") setTimeout(listen, 150)
      }
      rec.current = r
      setPhase("connecting")
      // A short ring, then the line opens.
      const t = setTimeout(() => {
        setPhase("listening")
        live.current.phase = "listening"
        listen()
      }, 1600)
      window.speechSynthesis?.getVoices()
      const i = setInterval(() => setSecs((s) => s + 1), 1000)
      const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose()
      window.addEventListener("keydown", k)
      return () => {
        clearTimeout(t)
        clearInterval(i)
        window.removeEventListener("keydown", k)
        r.onend = null
        r.abort()
        rec.current = null
        window.speechSynthesis?.cancel()
      }
    }
    const i = setInterval(() => setSecs((s) => s + 1), 1000)
    return () => clearInterval(i)
  }, [open, onClose])

  // When Walter finishes the turn, read the answer aloud, then listen again.
  useEffect(() => {
    if (!open) return
    return useChatStore.subscribe((s, prev) => {
      if (live.current.phase !== "thinking") return
      if (prev.turn?.phase !== "started" || s.turn?.phase === "started") return
      const items = s.threads[s.userId]?.items ?? []
      const say = speakable(latestReply(items))
      const synth = window.speechSynthesis
      if (!synth || !say) {
        setPhase("listening")
        live.current.phase = "listening"
        listen()
        return
      }
      const u = new SpeechSynthesisUtterance(say)
      const v = pickVoice()
      if (v) u.voice = v
      u.rate = 1.02
      u.onend = u.onerror = () => {
        if (!live.current.open) return
        setPhase("listening")
        live.current.phase = "listening"
        listen()
      }
      setPhase("speaking")
      synth.cancel()
      synth.speak(u)
    })
  }, [open])

  // Mute stops the microphone; unmute opens it again.
  useEffect(() => {
    if (!open) return
    if (muted) rec.current?.abort()
    else if (phase === "listening") listen()
  }, [muted])

  const hangUp = () => {
    window.speechSynthesis?.cancel()
    onClose()
  }

  const connected = phase !== "connecting"
  const t = Math.max(0, secs - 2)
  const mmss = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
  const problem = phase === "unsupported" || phase === "blocked" || phase === "error"
  const status = problem ? PHASE_TEXT[phase] : muted ? `Muted · ${mmss}` : connected ? `${PHASE_TEXT[phase]} · ${mmss}` : PHASE_TEXT.connecting
  const pulse = !reduce && !problem && !muted
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgb(20_33_61/.28)] p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={hangUp}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Call with Walter"
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 12, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex w-[320px] flex-col items-center gap-5 rounded-[8px] bg-white px-6 pt-9 pb-6 shadow-(--shadow-float)"
          >
            <div className="relative grid size-32 place-items-center">
              {pulse &&
                [0, 1].map((i) => (
                  <motion.span
                    key={`${phase}-${i}`}
                    className="absolute inset-3 rounded-[10px] border-2 border-crystal"
                    animate={{ scale: [1, phase === "speaking" ? 1.45 : 1.3], opacity: [0.5, 0] }}
                    transition={{ duration: phase === "speaking" ? 1 : phase === "thinking" ? 1.8 : 1.4, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
                  />
                ))}
              <motion.div animate={reduce || muted ? {} : phase === "speaking" ? { y: [0, -3, 0] } : { y: [0, -2, 0] }} transition={{ duration: phase === "speaking" ? 0.5 : 1.6, repeat: Infinity }}>
                <WalterAvatar size={104} className="rounded-[8px]" />
              </motion.div>
            </div>
            <div className="text-center" aria-live="polite">
              <div className="text-[18px] font-semibold">{connected ? "Walter" : "Calling Walter…"}</div>
              <div className="mt-0.5 max-w-[240px] text-[13px] text-pretty text-muted-foreground">{status}</div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                aria-pressed={muted}
                disabled={problem}
                onClick={() => setMuted((m) => !m)}
                className="btn-key size-12"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <button type="button" onClick={hangUp} className="btn-key btn-danger h-12 gap-2 px-5 text-[14px] font-semibold" aria-label="Hang up">
                <PhoneOff className="size-5" />
                Hang up
              </button>
            </div>
            <p className="text-center text-[11.5px] leading-snug text-muted-foreground">Answers and charts also land in your chat.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
