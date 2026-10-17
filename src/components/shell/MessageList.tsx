import { memo, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { CircleSlash, History, TriangleAlert } from "lucide-react"
import { CitationContext, SurfaceRenderer, citationOrder, makeCitations, type Citations } from "@/components/catalog"
import { CITATION_PATTERN, type EvidenceRef } from "@/contracts"
import { collectEvidence } from "@/lib/surface"
import { Markdown } from "./Markdown"
import { WalterAvatar, WorkerAvatar } from "@/components/brand/Avatar"
import { useChatStore, type ChatItem, type Thread } from "@/lib/stores/chat"
import { WORKER_BY_ID } from "@/lib/brand"
import type { Surface } from "@/lib/surface"
import { cn } from "@/lib/utils"
import { StatusDot } from "./WorkerCard"
import { useUserNames } from "./users"
import { sendMessage } from "./send"

const enter = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.18, ease: [0.2, 0.7, 0.2, 1] as const } }

const actions = { askFollowup: (t: string) => void sendMessage(t) }

const Artifact = memo(function Artifact({ surface, users }: { surface: Surface; users: Record<string, string> }) {
  return <SurfaceRenderer surface={surface} actions={actions} users={users} />
})

function Delegation({ item }: { item: Extract<ChatItem, { kind: "delegation" }> }) {
  const status = useChatStore((s) => (s.workers[item.workerId].currentTask?.taskId === item.taskId ? s.workers[item.workerId].status : "done"))
  return (
    <div className="flex items-center gap-2.5 py-0.5 pl-[46px] max-sm:pl-1" role="status">
      <span aria-hidden className="h-px w-3 bg-edge" />
      <WorkerAvatar id={item.workerId} size={20} className="rounded-[3px]" alt="" />
      <span className="text-[13.5px] text-muted-foreground italic">{item.line}</span>
      <span className="sr-only">{WORKER_BY_ID[item.workerId].name} is {status}</span>
      <StatusDot status={status} />
    </div>
  )
}

function Row({ item, surfaces, users }: { item: ChatItem; surfaces: Record<string, Surface>; users: Record<string, string> }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-[8px] rounded-br-[3px] bg-[#f3f3f3] px-4 py-2.5 text-[15px] leading-[1.5] text-ink whitespace-pre-wrap">
            {item.text}
          </div>
        </div>
      )
    case "assistant":
      return <Markdown text={item.text} streaming={item.streaming} className="pl-[46px] max-sm:pl-0" />
    case "delegation":
      return <Delegation item={item} />
    case "artifact": {
      const s = surfaces[item.surfaceId]
      if (!s) return null
      return (
        <div className="pl-[46px] max-sm:pl-0">
          <Artifact surface={s} users={users} />
        </div>
      )
    }
    case "past-finding":
      return (
        <div className="flex items-center gap-2 pl-[46px] text-[13px] text-muted-foreground max-sm:pl-0">
          <History className="size-3.5 shrink-0" />
          <span>
            Answered with: <span className="font-medium text-foreground">{item.title}</span>
          </span>
        </div>
      )
    case "notice":
      return (
        <div className={cn("flex items-center gap-2 pl-[46px] text-[13px] max-sm:pl-0", item.tone === "failed" ? "text-[#a1241a]" : "text-muted-foreground")}>
          {item.tone === "failed" ? <TriangleAlert className="size-3.5" /> : <CircleSlash className="size-3.5" />}
          {item.text}
        </div>
      )
  }
}

function WalterHeader({ working }: { working?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <WalterAvatar size={34} className={cn(working && "working-pulse")} />
      <span className="text-[14px] font-semibold">Walter</span>
    </div>
  )
}

function Thinking() {
  const startedAt = useChatStore((s) => s.turn?.startedAt ?? Date.now())
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), Math.max(0, 20000 - (Date.now() - startedAt)))
    return () => clearTimeout(t)
  }, [startedAt])
  return (
    <div className="flex items-center gap-1.5 pl-[46px] max-sm:pl-1" aria-label="Walter is working">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-[#8aa0b8]"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
      {slow && (
        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-2 text-[13px] text-muted-foreground">
          Still working. Checking the records properly takes a moment.
        </motion.span>
      )}
    </div>
  )
}

export function FollowUps({ items, label = "You could ask next", inset = true }: { items: string[]; label?: string; inset?: boolean }) {
  if (!items.length) return null
  return (
    <motion.div {...enter} initial={inset ? enter.initial : false} className={cn(inset && "pl-[46px] max-sm:pl-0")}>
      <div className="mb-2 text-[12.5px] text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((q) => (
          <button key={q} type="button" onClick={() => sendMessage(q)} className="btn-key h-auto min-h-8 px-3 py-1.5 text-left text-[13.5px] leading-snug">
            {q}
          </button>
        ))}
      </div>
    </motion.div>
  )
}

const STARTERS = [
  "Is SW-23 Well 001 producing right now?",
  "Which wells had the most downtime in the last 12 months?",
  "Where are the Northeast Block 8 wells, and how are they doing?",
  "Show recent maintenance for SW-23 Well 001",
]

function Empty(_: { userId: string }) {
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-start gap-5 pt-[8vh] max-sm:gap-4 max-sm:pt-2">
      <WalterAvatar size={64} className="max-sm:size-12" />
      <div>
        <h1 className="text-[30px] leading-tight max-sm:text-[24px] font-black tracking-[-0.03em]">Hi Boss. What's going on out there?</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          I keep one running conversation with you, so you can pick up where we left off. Ask about any well, spill, repair or deadline, and I'll bring in the right person.
        </p>
      </div>
      <FollowUps items={STARTERS} label="A few places to start" inset={false} />
    </div>
  )
}

/** Per-turn citation lookup: evidence from this turn's surfaces (finding data, refs) + indexed finding evidence. */
function useTurnCitations(thread: Thread | undefined): Citations[] {
  return useMemo(() => {
    const items = thread?.items ?? []
    const out: Citations[] = []
    let texts: string[] = []
    let refs: EvidenceRef[] = []
    let cites: string[] = []
    const flush = () => {
      out.push(makeCitations(refs, [...citationOrder(texts, CITATION_PATTERN), ...cites]))
      texts = []
      refs = []
      cites = []
    }
    items.forEach((it, i) => {
      if (it.kind === "user" && i > 0) flush()
      if (it.kind === "assistant") texts.push(it.text)
      if (it.kind === "artifact") {
        const s = thread!.surfaces[it.surfaceId]
        if (s) {
          refs.push(...collectEvidence(s.data).values())
          const fid = it.findingId ?? ((s.data.finding as { id?: string } | undefined)?.id)
          if (fid && thread!.evidence[fid]) refs.push(...thread!.evidence[fid])
          for (const c of Object.values(s.components)) {
            const p = c.props as { cite?: unknown; items?: Array<{ cite?: unknown }> }
            if (Array.isArray(p.cite)) cites.push(...p.cite.filter((x): x is string => typeof x === "string"))
            if (Array.isArray(p.items)) for (const x of p.items) if (Array.isArray(x?.cite)) cites.push(...x.cite.filter((y): y is string => typeof y === "string"))
          }
        }
      }
    })
    flush()
    return out
  }, [thread?.items, thread?.surfaces, thread?.evidence])
}

export function MessageList({ thread, userId }: { thread: Thread | undefined; userId: string }) {
  const users = useUserNames()
  const streaming = useChatStore((s) => s.turn?.phase === "started" && s.turn.userId === userId)
  const end = useRef<HTMLDivElement>(null)
  const items = thread?.items ?? []
  const cites = useTurnCitations(thread)
  const last = items.at(-1)
  const textLen = items.reduce((n, i) => n + (i.kind === "assistant" ? i.text.length : 0), 0)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [items.length, textLen, thread?.followUps.length, streaming])

  if (!items.length) return <Empty userId={userId} />

  // Group: a Walter header before the first non-user item of each turn.
  const rows: React.ReactNode[] = []
  let turn = 0
  items.forEach((it, i) => {
    if (it.kind === "user" && i > 0) turn++
    const prev = items[i - 1]
    if (it.kind !== "user" && (!prev || prev.kind === "user")) {
      const isLastTurn = !items.slice(i).some((x) => x.kind === "user")
      rows.push(
        <motion.div key={`h-${it.id}`} {...enter} className={cn(i > 0 && "pt-2")}>
          <WalterHeader working={streaming && isLastTurn} />
        </motion.div>,
      )
    }
    rows.push(
      <motion.div key={it.id} {...enter} layout="position" className={cn(it.kind === "user" && i > 0 && "pt-5")}>
        <CitationContext.Provider value={cites[turn] ?? cites[0]!}>
          <Row item={it} surfaces={thread!.surfaces} users={users} />
        </CitationContext.Provider>
      </motion.div>,
    )
  })

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3.5 pb-6" aria-live="polite" aria-relevant="additions">
      <AnimatePresence initial={false}>{rows}</AnimatePresence>
      {streaming && last?.kind === "user" && (
        <motion.div {...enter}>
          <WalterHeader working />
        </motion.div>
      )}
      {streaming && !items.some((i) => i.kind === "assistant" && i.streaming) && <Thinking />}
      {!streaming && thread && <div className="pt-2"><FollowUps items={thread.followUps} /></div>}
      <div ref={end} className="h-px" />
    </div>
  )
}
