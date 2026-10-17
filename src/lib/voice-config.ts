// Gemini Live is only Walter's voice; Walter (the normal chat turn) stays the brain.
// Shared by the token route (which locks these settings into the token) and the browser client.
import { Modality, Type, type LiveConnectConfig } from "@google/genai"

export const VOICE_MODEL = "gemini-3.8-live"
export const VOICE_API_VERSION = "v1alpha"

export const VOICE_SYSTEM = `You are the voice of Walter, a field operations copilot for an oil field: an old hand, calm, warm, a little dry, brief.
For ANY question or statement about wells, production, readings, spills, repairs, costs, rules, deadlines, people, notes, corrections or earlier conversations, call ask_walter with the user's words (lightly cleaned up, same meaning), then say its answer naturally in one to three short spoken sentences. Never invent numbers, names, dates or causes; only say what ask_walter returned. Say well IDs like "well one sixty-four".
If the answer mentions a chart or table, say it is in the chat. Small talk (hello, thanks) needs no tool. Keep it short; the user may interrupt you.`

export const ASK_WALTER = {
  name: "ask_walter",
  description: "Ask Walter and his crew (field status, maintenance, compliance, memory) a question or tell them something. Returns Walter's answer, which is also shown in the chat with charts and sources.",
  parameters: {
    type: Type.OBJECT,
    properties: { question: { type: Type.STRING, description: "The user's question or statement, in their words" } },
    required: ["question"],
  },
}

export const voiceSessionConfig = (): LiveConnectConfig => ({
  responseModalities: [Modality.AUDIO],
  systemInstruction: VOICE_SYSTEM,
  tools: [{ functionDeclarations: [ASK_WALTER] }],
  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Charon" } } },
})
