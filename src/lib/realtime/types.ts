import type { MouthShape } from "../audio/lipsync";

export type ConversationState =
  | "idle" // not connected
  | "connecting" // requesting mic / token / WebRTC
  | "listening" // connected, waiting for the user
  | "hearing" // user is speaking (VAD)
  | "thinking" // user finished, response pending
  | "speaking" // assistant audio is playing
  | "error";

export type Expression = "neutral" | "happy" | "curious" | "thinking" | "concerned";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
  at: number;
}

export interface ConversationCallbacks {
  onState: (state: ConversationState) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  /** Return true if the memory was saved (memory enabled), false otherwise. */
  onRemember: (fact: string) => boolean;
  onError: (message: string, fatal: boolean) => void;
}

/** Common surface for the live (OpenAI) and demo (offline) conversation engines. */
export interface ConversationClient {
  readonly kind: "live" | "demo";
  start(): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  /** Stop the assistant mid-sentence (barge-in by tap). */
  interrupt(): void;
  /** Current assistant mouth shape (called every animation frame). */
  sampleMouth(): MouthShape;
  /** Current user mic level 0..1 (called every animation frame). */
  sampleMic(): number;
}
