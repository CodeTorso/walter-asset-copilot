import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import { AnimatePresence, LayoutGroup, motion } from "motion/react"
import { Map as MapIcon, Phone, X } from "lucide-react"
import { WalterAvatar } from "@/components/brand/Avatar"
import { useChatStore } from "@/lib/stores/chat"
import { useBootstrap } from "@/lib/stores/bootstrap"
import { loadThread } from "@/lib/stores/transport"
import { WORKERS, WORKER_BY_ID } from "@/lib/brand"
import { cn } from "@/lib/utils"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { CallOverlay } from "./CallOverlay"
import { Composer } from "./Composer"
import { MessageList } from "./MessageList"
import { UserPicker } from "./UserPicker"
import { WorkerCard, WorkerChip } from "./WorkerCard"
import { useMediaQuery } from "./useMediaQuery"

const FieldMapPanel = lazy(() => import("./field-map/FieldMapPanel"))

function WorkerRail() {
  const workers = useChatStore((s) => s.workers)
  const busy = WORKERS.filter((w) => workers[w.id].status === "working" || workers[w.id].status === "queued").length
  return (
    <aside aria-label="Walter's crew" className="panel-shell flex w-[272px] shrink-0 flex-col p-3 max-lg:hidden">
      <div className="flex items-center gap-2.5 px-1 pt-1 pb-3">
        <WalterAvatar size={30} />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-[-0.01em]">Walter</div>
          <div className="text-[12px] text-muted-foreground">Field operations</div>
        </div>
      </div>
      <div className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-[13px] font-semibold">Crew</h2>
        <span data-tnum className="text-[12px] text-muted-foreground" aria-live="polite">
          {busy ? `${busy} on a task` : "All free"}
        </span>
      </div>
      <LayoutGroup>
        <div className="flex flex-col gap-2">
          {WORKERS.map((w) => (
            <WorkerCard key={w.id} w={workers[w.id]} />
          ))}
        </div>
      </LayoutGroup>
      <div className="mt-auto pt-3">
        <UserPicker />
      </div>
    </aside>
  )
}

function HeaderStatus() {
  const turn = useChatStore((s) => s.turn)
  const workers = useChatStore((s) => s.workers)
  const active = WORKERS.filter((w) => ["working", "queued"].includes(workers[w.id].status)).map((w) => WORKER_BY_ID[w.id].name)
  const streaming = turn?.phase === "started"
  const text = streaming ? (active.length ? `Working with ${active.join(" and ")}` : "Thinking it through") : "Ready when you are"
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground" aria-live="polite">
      <span className={cn("size-1.5 rounded-full", streaming ? "working-pulse bg-crystal" : "bg-[#1f8a4c]")} />
      {text}
    </span>
  )
}

export function AppShell() {
  const userId = useChatStore((s) => s.userId)
  const thread = useChatStore((s) => s.threads[s.userId])
  const workers = useChatStore((s) => s.workers)
  const [mapOpen, setMapOpen] = useState(false)
  const [callOpen, setCallOpen] = useState(false)
  const closeCall = useCallback(() => setCallOpen(false), [])
  const wide = useMediaQuery("(min-width: 1024px)")
  const boot = useBootstrap((s) => s.status)
  useEffect(() => {
    void useBootstrap.getState().load()
  }, [])
  const users = useBootstrap((s) => s.users)
  useEffect(() => {
    if (boot !== "live" && boot !== "fallback") return
    if (!users.some((u) => u.userId === userId) && users[0]) return useChatStore.getState().setUser(users[0].userId)
    void loadThread(userId)
  }, [boot, userId, users])

  return (
    <div className="flex h-dvh gap-3 bg-[#eef1f4] p-3 max-lg:flex-col max-lg:gap-0 max-lg:p-0">
      <WorkerRail />

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-border bg-white shadow-[inset_0_1px_0_#fff,0_1px_0_rgb(16_24_40/.04),0_10px_30px_-18px_rgb(16_24_40/.22)] max-lg:rounded-none max-lg:border-0 max-lg:shadow-none">
        <header className="relative z-10 border-b border-border bg-white/90 backdrop-blur">
          <div className="grid h-16 grid-cols-[1fr_minmax(0,760px)_1fr] items-center gap-3 px-5 max-lg:flex max-lg:px-3">
            <span className="max-lg:hidden" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <WalterAvatar size={40} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[17px] font-semibold tracking-[-0.015em]">Walter</div>
                <HeaderStatus />
              </div>
              <button type="button" onClick={() => setCallOpen(true)} className="btn-key size-10" aria-label="Call Walter">
                <Phone className="size-[18px]" />
              </button>
            </div>
            <div className="flex items-center justify-end gap-2">
              <div className="lg:hidden">
                <UserPicker compact />
              </div>
              <button
                type="button"
                onClick={() => setMapOpen((o) => !o)}
                aria-pressed={mapOpen}
                className="btn-key size-10"
                aria-label={mapOpen ? "Close field map" : "Open field map"}
                title="Field map"
              >
                {mapOpen && wide ? <X className="size-[18px]" /> : <MapIcon className="size-[18px]" />}
              </button>
            </div>
          </div>
          {/* Mobile: crew as a horizontal strip */}
          <div className="flex gap-2 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden" aria-label="Walter's crew">
            {WORKERS.map((w) => (
              <WorkerChip key={w.id} w={workers[w.id]} />
            ))}
          </div>
        </header>

        <div className="scroll-thin flex-1 overflow-y-auto px-5 pt-6 max-sm:px-3">
          <MessageList thread={thread} userId={userId} />
        </div>

        <div className="border-t border-border bg-gradient-to-b from-white to-[#fafbfc] px-5 pt-3 pb-4 max-sm:px-3 max-sm:pt-2.5 max-sm:pb-[max(10px,env(safe-area-inset-bottom))]">
          <Composer />
          <p className="mx-auto mt-2 max-w-[760px] text-center text-[11.5px] text-[#8691a1] max-sm:hidden">
            Walter answers from inspections, repairs, notes and manuals. Every figure links to its record.
          </p>
        </div>
      </main>

      {wide ? (
        <AnimatePresence initial={false}>
          {mapOpen && (
            <motion.aside
              key="map"
              aria-label="Field map"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 460, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
              className="shrink-0 overflow-hidden"
            >
              <div className="h-full w-[460px] overflow-hidden rounded-[8px] border border-border bg-white shadow-[0_10px_30px_-18px_rgb(16_24_40/.22)]">
                <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading map…</div>}>
                  <FieldMapPanel onClose={() => setMapOpen(false)} />
                </Suspense>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      ) : (
        <Sheet open={mapOpen} onOpenChange={setMapOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-full" showCloseButton={false}>
            <SheetTitle className="sr-only">Field map</SheetTitle>
            <SheetDescription className="sr-only">Every well, coloured by status, from the latest weekly inspection.</SheetDescription>
            <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Loading map…</div>}>
              <FieldMapPanel onClose={() => setMapOpen(false)} />
            </Suspense>
          </SheetContent>
        </Sheet>
      )}

      <CallOverlay open={callOpen} onClose={closeCall} />
    </div>
  )
}
