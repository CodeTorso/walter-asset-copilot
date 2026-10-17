import { useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowUp, Square } from "lucide-react"
import { useChatStore } from "@/lib/stores/chat"
import { sendMessage } from "./send"

export function Composer() {
  const [text, setText] = useState("")
  const ta = useRef<HTMLTextAreaElement>(null)
  const streaming = useChatStore((s) => s.turn?.phase === "started")
  const stop = useChatStore((s) => s.stop)

  const submit = () => {
    if (streaming) return
    if (sendMessage(text)) {
      setText("")
      requestAnimationFrame(() => ta.current && (ta.current.style.height = ""))
    }
  }

  return (
    <form
      className="mx-auto flex w-full max-w-[760px] items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="field flex min-h-12 flex-1 items-center">
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
          placeholder="Ask about any well, spill or repair…"
          className="block max-h-[180px] w-full resize-none bg-transparent px-4 py-3 text-[15.5px] leading-6 text-ink outline-none placeholder:text-[#9a9a9a]"
        />
      </div>
      <button
        type={streaming ? "button" : "submit"}
        onClick={streaming ? stop : undefined}
        disabled={!streaming && !text.trim()}
        aria-label={streaming ? "Stop Walter" : "Send"}
        className={`btn-key size-12 shrink-0 ${streaming ? "btn-danger" : ""} disabled:opacity-100! disabled:text-[#a3a3a3]`}
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
