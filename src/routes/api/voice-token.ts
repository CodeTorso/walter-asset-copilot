import { createFileRoute } from "@tanstack/react-router"
import { GoogleGenAI } from "@google/genai"
import { VOICE_API_VERSION, VOICE_MODEL, voiceSessionConfig } from "@/lib/voice-config"

// Mints a short-lived, single-use Gemini Live token for the browser's voice call. The API key never
// leaves the server; the token is locked to Walter's voice model and session settings.
export const Route = createFileRoute("/api/voice-token")({
  server: {
    handlers: {
      POST: async () => {
        const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
        if (!apiKey) return Response.json({ error: "Voice is not configured on this server." }, { status: 503 })
        try {
          const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: VOICE_API_VERSION } })
          const expireTime = new Date(Date.now() + 30 * 60_000).toISOString()
          const token = await ai.authTokens.create({
            config: {
              uses: 1,
              expireTime,
              newSessionExpireTime: new Date(Date.now() + 60_000).toISOString(),
              liveConnectConstraints: { model: VOICE_MODEL, config: voiceSessionConfig() },
              httpOptions: { apiVersion: VOICE_API_VERSION },
            },
          })
          if (!token.name) throw new Error("no token returned")
          return Response.json({ token: token.name, model: VOICE_MODEL, apiVersion: VOICE_API_VERSION, expireTime }, { headers: { "cache-control": "no-store" } })
        } catch (e) {
          console.error("[voice] token failed:", e instanceof Error ? e.message.slice(0, 200) : "unknown")
          return Response.json({ error: "Couldn't start a voice session." }, { status: 502 })
        }
      },
    },
  },
})
