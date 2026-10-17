// Browser side of a voice call: Gemini Live is the voice, Walter is the brain.
// Mic audio (16 kHz PCM) streams to Live; Live's 24 kHz audio plays back; when Live calls ask_walter,
// the question runs through the normal chat turn (bubble, crew, cards, citations) and Walter's reply
// goes back as the tool response for Live to speak.
import { GoogleGenAI, type LiveServerMessage, type Session } from "@google/genai"
import { liveTurn } from "@/lib/stores/transport"
import { useChatStore, type ChatItem } from "@/lib/stores/chat"
import { voiceSessionConfig } from "@/lib/voice-config"

export type VoicePhase = "connecting" | "listening" | "checking" | "speaking" | "error"

/** Walter's words as they should sound: no citation markers, markdown or tables. */
export function speakable(text: string) {
  return text
    .replace(/\[\[[^\]]+\]\]/g, "")
    .replace(/\$[^$]*\$/g, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** Text Walter wrote in the latest turn, once it has finished. */
function latestReply(items: ChatItem[]) {
  let lastUser = -1
  items.forEach((i, k) => i.kind === "user" && (lastUser = k))
  const after = items.slice(lastUser + 1)
  const text = after.filter((i): i is Extract<ChatItem, { kind: "assistant" }> => i.kind === "assistant").map((i) => i.text).join(" ")
  if (text.trim()) return { answer: speakable(text), shownInChat: after.some((i) => i.kind === "artifact") }
  if (after.some((i) => i.kind === "notice")) return { error: "Walter couldn't finish that answer. Suggest asking again." }
  return { answer: "The answer is in the chat.", shownInChat: true }
}

// Captures mono mic frames and posts Float32 chunks of ~128 ms to the main thread.
const WORKLET = `
class Pcm16 extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i]
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
    }
    return true
  }
}
registerProcessor("pcm16-capture", Pcm16)
`

const toBase64 = (bytes: Uint8Array) => {
  let s = ""
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const floatToPcm16 = (f: Float32Array) => {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i]!)) * 0x7fff
  return new Uint8Array(out.buffer)
}
const pcm16ToFloat = (b64: string) => {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2))
  const f = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 0x8000
  return f
}

export class VoiceCall {
  private session: Session | null = null
  private stream: MediaStream | null = null
  private micCtx: AudioContext | null = null
  private outCtx: AudioContext | null = null
  private playing = new Set<AudioBufferSourceNode>()
  private playHead = 0
  private closed = false
  private checking = false
  muted = false

  constructor(private onPhase: (p: VoicePhase, message?: string) => void) {}

  async start() {
    try {
      const res = await fetch("/api/voice-token", { method: "POST" })
      const tok = (await res.json().catch(() => ({}))) as { token?: string; model?: string; apiVersion?: string; error?: string }
      if (!res.ok || !tok.token || !tok.model) throw new Error(tok.error ?? `voice token ${res.status}`)
      if (this.closed) return

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).catch((e) => {
        throw new Error(e?.name === "NotAllowedError" ? "Microphone access is blocked. Allow it in the address bar, then call again." : "No microphone is available.")
      })
      if (this.closed) return this.stop()

      this.outCtx = new AudioContext({ sampleRate: 24000 })
      this.micCtx = new AudioContext({ sampleRate: 16000 })
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }))
      await this.micCtx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)

      const ai = new GoogleGenAI({ apiKey: tok.token, httpOptions: { apiVersion: tok.apiVersion ?? "v1alpha" } })
      this.session = await ai.live.connect({
        model: tok.model,
        config: voiceSessionConfig(),
        callbacks: {
          onmessage: (m) => this.onMessage(m),
          onerror: () => this.fail("The voice line dropped. Hang up and call again."),
          onclose: (e) => {
            if (!this.closed) this.fail(e?.code === 1000 ? "The call ended." : "The voice line dropped. Hang up and call again.")
          },
        },
      })
      if (this.closed) return this.stop()

      const src = this.micCtx.createMediaStreamSource(this.stream)
      const node = new AudioWorkletNode(this.micCtx, "pcm16-capture")
      node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
        if (this.muted || !this.session || this.closed) return
        this.session.sendRealtimeInput({ audio: { data: toBase64(floatToPcm16(ev.data)), mimeType: "audio/pcm;rate=16000" } })
      }
      src.connect(node)
      this.onPhase("listening")
      // Dev-only test hook: type into the live session as if spoken.
      if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__walterVoice = { say: (text: string) => this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true }) }
      // Walter answers the phone.
      this.session.sendClientContent({ turns: [{ role: "user", parts: [{ text: "(The call just connected. Greet me in a few words as Walter, then wait.)" }] }], turnComplete: true })
    } catch (e) {
      this.fail(e instanceof Error ? e.message : "Couldn't start the call.")
    }
  }

  private onMessage(m: LiveServerMessage) {
    if (m.toolCall?.functionCalls?.length) {
      for (const fc of m.toolCall.functionCalls) void this.askWalter(fc.id ?? "", fc.name ?? "ask_walter", String((fc.args as { question?: unknown } | undefined)?.question ?? ""))
      return
    }
    const sc = m.serverContent
    if (!sc) return
    if (sc.interrupted) this.stopPlayback()
    for (const p of sc.modelTurn?.parts ?? []) if (p.inlineData?.data) this.play(p.inlineData.data)
  }

  private async askWalter(id: string, name: string, question: string) {
    if (!this.session) return
    this.checking = true
    this.onPhase("checking")
    let response: Record<string, unknown>
    if (!question.trim()) response = { error: "No question was heard." }
    else if (useChatStore.getState().turn?.phase === "started") response = { error: "Walter is still answering the last question." }
    else {
      await liveTurn(question)
      const s = useChatStore.getState()
      response = latestReply(s.threads[s.userId]?.items ?? [])
    }
    this.checking = false
    if (this.closed || !this.session) return
    this.session.sendToolResponse({ functionResponses: [{ id, name, response }] })
    this.onPhase("listening")
  }

  private play(b64: string) {
    const ctx = this.outCtx
    if (!ctx || this.closed) return
    const f = pcm16ToFloat(b64)
    if (!f.length) return
    const buf = ctx.createBuffer(1, f.length, 24000)
    buf.copyToChannel(f, 0)
    const node = ctx.createBufferSource()
    node.buffer = buf
    node.connect(ctx.destination)
    const at = Math.max(ctx.currentTime + 0.02, this.playHead)
    node.start(at)
    this.playHead = at + buf.duration
    this.playing.add(node)
    this.onPhase("speaking")
    node.onended = () => {
      this.playing.delete(node)
      if (!this.playing.size && !this.closed) this.onPhase(this.checking ? "checking" : "listening")
    }
  }

  private stopPlayback() {
    for (const n of this.playing) {
      n.onended = null
      try {
        n.stop()
      } catch {}
    }
    this.playing.clear()
    this.playHead = 0
    if (!this.closed) this.onPhase(this.checking ? "checking" : "listening")
  }

  private fail(message: string) {
    if (this.closed) return
    this.onPhase("error", message)
    this.stop()
  }

  stop() {
    this.closed = true
    this.stopPlayback()
    try {
      this.session?.close()
    } catch {}
    this.session = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    void this.micCtx?.close().catch(() => {})
    void this.outCtx?.close().catch(() => {})
    this.micCtx = this.outCtx = null
  }
}
