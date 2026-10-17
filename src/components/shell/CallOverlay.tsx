import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { WalterAvatar } from "@/components/brand/Avatar"

/** UI-only call state. No audio and no transcript, by design. */
export function CallOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [muted, setMuted] = useState(false)
  const [secs, setSecs] = useState(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!open) return
    setSecs(0)
    setMuted(false)
    const i = setInterval(() => setSecs((s) => s + 1), 1000)
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", k)
    return () => {
      clearInterval(i)
      window.removeEventListener("keydown", k)
    }
  }, [open, onClose])
  const connected = secs >= 3
  const mmss = `${String(Math.floor((secs - 3) / 60)).padStart(2, "0")}:${String((secs - 3) % 60).padStart(2, "0")}`
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
            className="flex w-[320px] flex-col items-center gap-5 rounded-[8px] border border-edge bg-white px-6 pt-9 pb-6 shadow-[inset_0_1px_0_#fff,0_1px_0_rgb(16_24_40/.05),0_24px_60px_-20px_rgb(16_24_40/.45)]"
          >
            <div className="relative grid size-32 place-items-center">
              {!reduce &&
                [0, 1].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute inset-3 rounded-[10px] border-2 border-crystal"
                    animate={{ scale: [1, 1.35], opacity: [0.5, 0] }}
                    transition={{ duration: connected ? 2.2 : 1.4, repeat: Infinity, delay: i * (connected ? 1.1 : 0.7), ease: "easeOut" }}
                  />
                ))}
              <motion.div animate={reduce || muted ? {} : { y: [0, -2, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>
                <WalterAvatar size={104} className="rounded-[8px]" />
              </motion.div>
            </div>
            <div className="text-center" aria-live="polite">
              <div className="text-[18px] font-semibold">{connected ? "Walter" : "Calling Walter…"}</div>
              <div className="mt-0.5 text-[13px] text-muted-foreground">
                {connected ? (muted ? `Muted · ${mmss}` : mmss) : "Ringing"}
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                aria-pressed={muted}
                onClick={() => setMuted((m) => !m)}
                className="btn-key size-12"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </button>
              <button type="button" onClick={onClose} className="btn-key btn-danger h-12 gap-2 px-5 text-[14px] font-semibold" aria-label="Hang up">
                <PhoneOff className="size-5" />
                Hang up
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
