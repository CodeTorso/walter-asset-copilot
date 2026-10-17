import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { WORKERS } from "@/lib/brand"
import { useChatStore } from "@/lib/stores/chat"
import type { VoiceCall, VoicePhase } from "@/lib/voice-live"
import { cn } from "@/lib/utils"

// A voice call with Walter as a small floating orb (top-right, not modal): the chat, cards and crew
// stay usable during the call. Gemini Live is the voice; real questions go to Walter through the
// normal chat turn, so answers, charts and sources land in the chat. No transcript, by design.

function useCrewLabel() {
  return useChatStore((s) => {
    const busy = WORKERS.filter((w) => s.workers[w.id].status === "working" || s.workers[w.id].status === "queued").map((w) => w.name)
    return busy.length ? `Checking with ${busy.join(" and ")}` : "Checking with the crew"
  })
}

export function CallOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [muted, setMuted] = useState(false)
  const [phase, setPhase] = useState<VoicePhase>("connecting")
  const [error, setError] = useState<string | null>(null)
  const call = useRef<VoiceCall | null>(null)
  const orb = useRef<HTMLDivElement>(null)
  const crew = useCrewLabel()

  useEffect(() => {
    if (!open) return
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
        if (p === "error") setError(message ?? "The call couldn't connect.")
      })
      call.current = c
      void c.start()
    })
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => {
      gone = true
      window.removeEventListener("keydown", k)
      c?.stop()
      call.current = null
    }
  }, [open, onClose])

  useEffect(() => {
    if (call.current) call.current.muted = muted
  }, [muted])

  // The orb breathes with the live audio: the user's voice while listening, Walter's while speaking.
  useEffect(() => {
    if (!open) return
    let raf = 0
    let lvl = 0
    const tick = () => {
      const c = call.current
      const target = c && !muted ? (phase === "listening" ? c.level("input") : phase === "speaking" ? c.level("output") : 0) : 0
      lvl += (target - lvl) * (target > lvl ? 0.45 : 0.12)
      orb.current?.style.setProperty("--lvl", lvl.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, phase, muted])

  const label = error ? null : muted ? "Muted" : phase === "connecting" ? "Calling Walter" : phase === "listening" ? "Listening" : phase === "checking" ? crew : "Walter is speaking"

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -6 }}
          transition={{ duration: 0.18 }}
          className="fixed top-[86px] right-5 z-40 max-sm:top-[122px] max-sm:right-3"
        >
          <OrbView ref={orb} phase={phase} muted={muted} label={label} error={error} onMute={() => setMuted((m) => !m)} onHangUp={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The orb with its state label and mute / hang-up keys. Presentational; also shown in the lab. */
export function OrbView({
  ref,
  phase,
  muted,
  label,
  error,
  onMute,
  onHangUp,
}: {
  ref?: React.Ref<HTMLDivElement>
  phase: VoicePhase
  muted: boolean
  label: string | null
  error: string | null
  onMute: () => void
  onHangUp: () => void
}) {
  return (
    <div className="group flex items-center gap-2" role="region" aria-label="Voice call with Walter">
      <div className="flex min-w-0 flex-col items-end gap-1">
        <div className="flex items-center gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
          <button type="button" aria-pressed={muted} disabled={!!error} onClick={onMute} className="btn-key size-8 rounded-full bg-white shadow-(--shadow-float)" aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
          </button>
          <button type="button" onClick={onHangUp} className="btn-key btn-danger size-8 rounded-full shadow-(--shadow-float)" aria-label="Hang up">
            <PhoneOff className="size-3.5" />
          </button>
        </div>
        <span aria-live="polite" className={cn("max-w-[220px] rounded-full bg-white/90 px-2.5 py-1 text-right text-[12px] leading-tight shadow-(--shadow-float) backdrop-blur-sm", error ? "text-[#a1241a]" : "text-muted-foreground")}>
          {error ?? label}
        </span>
      </div>
      <div ref={ref} tabIndex={0} role="img" aria-label={`Walter call: ${error ?? label}. Press Escape to hang up.`} data-phase={phase} data-muted={muted} className="orb shrink-0">
        <i className="orb-a" />
        <i className="orb-b" />
        <i className="orb-c" />
      </div>
    </div>
  )
}
