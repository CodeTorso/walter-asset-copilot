import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowUp, Square } from "lucide-react"
import { useChatStore } from "@/lib/stores/chat"
import { useMediaQuery } from "./useMediaQuery"
import { sendMessage } from "./send"

export function Composer() {
  const [text, setText] = useState("")
  const ta = useRef<HTMLTextAreaElement>(null)
  const streaming = useChatStore((s) => s.turn?.phase === "started")
  const stop = useChatStore((s) => s.stop)
  const roomy = useMediaQuery("(min-width: 640px)")

  const submit = () => {
    if (streaming) return
    if (sendMessage(text)) {
      setText("")
      requestAnimationFrame(() => ta.current && (ta.current.style.height = ""))
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-[760px] items-end gap-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="flex min-h-12 flex-1 items-center rounded-[6px] border border-edge bg-white shadow-[inset_0_1px_2px_rgb(16_24_40/.06),0_1px_0_#fff] transition-[border-color,box-shadow] focus-within:border-crystal focus-within:shadow-[0_0_0_3px_var(--crystal-soft),inset_0_1px_2px_rgb(16_24_40/.06)]">
        <label htmlFor="composer" className="sr-only">
          Message Walter
        </label>
        <textarea
          id="composer"
          ref={ta}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            const el = e.target
            el.style.height = "auto"
            el.style.height = `${Math.min(el.scrollHeight, 180)}px`
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={roomy ? "Ask about a well, a spill, or that repair from last week…" : "Ask about a well, spill or repair…"}
          className="block max-h-[180px] w-full resize-none bg-transparent px-3.5 py-3 text-[15.5px] leading-6 outline-none placeholder:text-[#8691a1]"
        />
      </div>
      <button
        type={streaming ? "button" : "submit"}
        onClick={streaming ? stop : undefined}
        disabled={!streaming && !text.trim()}
        aria-label={streaming ? "Stop Walter" : "Send"}
        className={`btn-key size-12 shrink-0 ${streaming ? "btn-danger" : "btn-ink"} disabled:opacity-100! disabled:bg-[#e9edf2] disabled:text-[#8a96a6] disabled:border-edge disabled:shadow-none`}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={streaming ? "stop" : "send"}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="grid place-items-center"
          >
            {streaming ? <Square className="size-4 fill-current" /> : <ArrowUp className="size-5" strokeWidth={2.4} />}
          </motion.span>
        </AnimatePresence>
      </button>
    </form>
  )
}
