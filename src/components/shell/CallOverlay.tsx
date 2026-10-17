import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { WalterAvatar } from "@/components/brand/Avatar"
import type { VoiceCall, VoicePhase } from "@/lib/voice-live"

// A voice call with Walter. Gemini Live is the voice; every real question goes to Walter through the
// normal chat turn, so answers, charts and sources also land in the chat. No transcript, by design.

const PHASE_TEXT: Record<VoicePhase, string> = {
  connecting: "Ringing",
  listening: "Listening",
  checking: "Checking with the crew",
  speaking: "Speaking",
  error: "The call couldn't connect.",
}

export function CallOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [muted, setMuted] = useState(false)
  const [secs, setSecs] = useState(0)
  const [phase, setPhase] = useState<VoicePhase>("connecting")
  const [error, setError] = useState<string | null>(null)
  const call = useRef<VoiceCall | null>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return
    setSecs(0)
    setMuted(false)
    setError(null)
    setPhase("connecting")
    let c: VoiceCall | null = null
    let gone = false
    // The Live SDK loads only when a call starts.
    void import("@/lib/voice-live").then(({ VoiceCall }) => {
      if (gone) return
      c = new VoiceCall((p, message) => {
        setPhase(p)
        if (p === "error") setError(message ?? PHASE_TEXT.error)
      })
      c.muted = false
      call.current = c
      void c.start()
    })
    const i = setInterval(() => setSecs((s) => s + 1), 1000)
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => {
      clearInterval(i)
      window.removeEventListener("keydown", k)
      gone = true
      c?.stop()
      call.current = null
    }
  }, [open, onClose])

  useEffect(() => {
    if (call.current) call.current.muted = muted
  }, [muted])

  const connected = phase !== "connecting" && phase !== "error"
  const mmss = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`
  const status = error ?? (muted ? `Muted · ${mmss}` : connected ? `${PHASE_TEXT[phase]} · ${mmss}` : PHASE_TEXT.connecting)
  const pulse = !reduce && !error && !muted
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgb(20_33_61/.28)] p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
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
                    transition={{ duration: phase === "speaking" ? 1 : phase === "checking" ? 1.8 : 1.4, repeat: Infinity, delay: i * 0.6, ease: "easeOut" }}
                  />
                ))}
              <motion.div animate={reduce || muted || error ? {} : phase === "speaking" ? { y: [0, -3, 0] } : { y: [0, -2, 0] }} transition={{ duration: phase === "speaking" ? 0.5 : 1.6, repeat: Infinity }}>
                <WalterAvatar size={104} className="rounded-[8px]" />
              </motion.div>
            </div>
            <div className="text-center" aria-live="polite">
              <div className="text-[18px] font-semibold">{connected ? "Walter" : error ? "Walter" : "Calling Walter…"}</div>
              <div className={error ? "mt-1 max-w-[250px] text-[13px] text-pretty text-[#a1241a]" : "mt-0.5 max-w-[250px] text-[13px] text-pretty text-muted-foreground"}>{status}</div>
            </div>
            <div className="flex gap-3">
              <button type="button" aria-pressed={muted} disabled={!!error} onClick={() => setMuted((m) => !m)} className="btn-key size-12" aria-label={muted ? "Unmute" : "Mute"}>
                {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <button type="button" onClick={onClose} className="btn-key btn-danger h-12 gap-2 px-5 text-[14px] font-semibold" aria-label="Hang up">
                <PhoneOff className="size-5" />
                Hang up
              </button>
            </div>
            <p className="text-center text-[11.5px] leading-snug text-muted-foreground">Answers, charts and sources also land in your chat.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
