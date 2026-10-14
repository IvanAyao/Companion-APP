import type { ConversationCallbacks, ConversationState } from "./types";

/**
 * Translates OpenAI Realtime server events (received over the WebRTC data
 * channel) into app state, captions and tool calls. Kept free of WebRTC so it
 * can be unit-tested with plain event objects.
 */

type ServerEvent = { type: string; [key: string]: unknown };
type Send = (event: Record<string, unknown>) => void;

interface FunctionCallItem {
  type: "function_call";
  name: string;
  call_id: string;
  arguments: string;
}

export class RealtimeEventRouter {
  private state: ConversationState = "listening";
  private transcripts = new Map<string, string>();
  private handledCalls = new Set<string>();
  private assistantPlaying = false;

  constructor(
    private cb: ConversationCallbacks,
    private send: Send,
  ) {}

  get current(): ConversationState {
    return this.state;
  }

  private setState(next: ConversationState) {
    if (next === this.state) return;
    this.state = next;
    this.cb.onState(next);
  }

  private caption(id: string, role: "user" | "assistant", text: string, final: boolean) {
    this.transcripts.set(id, text);
    this.cb.onTranscript({ id, role, text, final, at: Date.now() });
  }

  handle(raw: string | ServerEvent) {
    let ev: ServerEvent;
    try {
      ev = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    switch (ev.type) {
      // ---- user turn ---------------------------------------------------
      case "input_audio_buffer.speech_started":
        // With interrupt_response the server cancels any reply in progress;
        // in WebRTC mode it also clears the queued audio.
        this.setState("hearing");
        break;
      case "input_audio_buffer.speech_stopped":
      case "input_audio_buffer.committed":
        if (this.state === "hearing") this.setState("thinking");
        break;
      case "conversation.item.input_audio_transcription.delta": {
        const id = String(ev.item_id);
        this.caption(id, "user", (this.transcripts.get(id) ?? "") + String(ev.delta ?? ""), false);
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        this.caption(String(ev.item_id), "user", String(ev.transcript ?? "").trim(), true);
        break;

      // ---- assistant turn ----------------------------------------------
      case "response.created":
        if (this.state !== "hearing" && !this.assistantPlaying) this.setState("thinking");
        break;
      case "output_audio_buffer.started":
        this.assistantPlaying = true;
        this.setState("speaking");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        this.assistantPlaying = false;
        if (this.state === "speaking" || this.state === "thinking") this.setState("listening");
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const id = String(ev.item_id);
        this.caption(id, "assistant", (this.transcripts.get(id) ?? "") + String(ev.delta ?? ""), false);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        this.caption(String(ev.item_id), "assistant", String(ev.transcript ?? this.transcripts.get(String(ev.item_id)) ?? ""), true);
        break;
      case "response.done":
        this.handleResponseDone(ev);
        break;

      // ---- errors ------------------------------------------------------
      case "error": {
        const err = (ev.error ?? {}) as { message?: string; code?: string };
        // Cancelling when nothing is playing is harmless; don't surface it.
        if (err.code === "response_cancel_not_active") break;
        this.cb.onError(err.message ?? "The voice service reported an error.", false);
        break;
      }
    }
  }

  private handleResponseDone(ev: ServerEvent) {
    const response = (ev.response ?? {}) as { output?: unknown[]; status?: string };
    const calls = (response.output ?? []).filter(
      (o): o is FunctionCallItem => (o as FunctionCallItem)?.type === "function_call",
    );
    let needsFollowUp = false;
    for (const call of calls) {
      if (this.handledCalls.has(call.call_id)) continue;
      this.handledCalls.add(call.call_id);
      let output: Record<string, unknown>;
      if (call.name === "remember_preference") {
        let fact = "";
        try {
          fact = String((JSON.parse(call.arguments || "{}") as { fact?: unknown }).fact ?? "");
        } catch {
          /* malformed args */
        }
        const saved = fact ? this.cb.onRemember(fact) : false;
        output = saved
          ? { saved: true }
          : { saved: false, reason: "Memory is turned off or the fact was empty. Tell the user they can enable memory in settings." };
      } else {
        output = { error: `Unknown tool ${call.name}` };
      }
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) },
      });
      needsFollowUp = true;
    }
    if (needsFollowUp) {
      this.send({ type: "response.create" });
    } else if (!this.assistantPlaying && this.state === "thinking") {
      // Text-only / empty responses: nothing will play, go back to listening.
      this.setState("listening");
    }
  }
}
