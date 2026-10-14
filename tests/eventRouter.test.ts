import { describe, expect, it, vi } from "vitest";
import { RealtimeEventRouter } from "@/lib/realtime/eventRouter";
import type { ConversationCallbacks, ConversationState, TranscriptEntry } from "@/lib/realtime/types";

function setup(remember = true) {
  const states: ConversationState[] = [];
  const captions: TranscriptEntry[] = [];
  const sent: Record<string, unknown>[] = [];
  const cb: ConversationCallbacks = {
    onState: (s) => states.push(s),
    onTranscript: (e) => captions.push(e),
    onRemember: vi.fn(() => remember),
    onError: vi.fn(),
  };
  const router = new RealtimeEventRouter(cb, (e) => sent.push(e));
  return { router, states, captions, sent, cb };
}

describe("RealtimeEventRouter", () => {
  it("walks through a normal turn", () => {
    const { router, states } = setup();
    router.handle({ type: "input_audio_buffer.speech_started" });
    router.handle({ type: "input_audio_buffer.speech_stopped" });
    router.handle({ type: "response.created" });
    router.handle({ type: "output_audio_buffer.started" });
    router.handle(JSON.stringify({ type: "response.done", response: { output: [] } }));
    router.handle({ type: "output_audio_buffer.stopped" });
    expect(states).toEqual(["hearing", "thinking", "speaking", "listening"]);
  });

  it("handles barge-in: user speech while speaking", () => {
    const { router, states } = setup();
    router.handle({ type: "output_audio_buffer.started" });
    router.handle({ type: "input_audio_buffer.speech_started" });
    router.handle({ type: "output_audio_buffer.cleared" });
    expect(states).toEqual(["speaking", "hearing"]);
    expect(router.current).toBe("hearing");
  });

  it("accumulates transcript deltas and finalizes", () => {
    const { router, captions } = setup();
    router.handle({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "Hel" });
    router.handle({ type: "response.output_audio_transcript.delta", item_id: "a1", delta: "lo!" });
    router.handle({ type: "response.output_audio_transcript.done", item_id: "a1", transcript: "Hello!" });
    router.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: " hi " });
    expect(captions.map((c) => [c.role, c.text, c.final])).toEqual([
      ["assistant", "Hel", false],
      ["assistant", "Hello!", false],
      ["assistant", "Hello!", true],
      ["user", "hi", true],
    ]);
  });

  it("answers remember_preference tool calls once and asks for a follow-up response", () => {
    const { router, sent, cb } = setup(true);
    const done = {
      type: "response.done",
      response: { output: [{ type: "function_call", name: "remember_preference", call_id: "c1", arguments: '{"fact":"Likes tea"}' }] },
    };
    router.handle(done);
    router.handle(done); // duplicate delivery is ignored
    expect(cb.onRemember).toHaveBeenCalledWith("Likes tea");
    expect(cb.onRemember).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1" } });
    expect(JSON.parse((sent[0].item as { output: string }).output)).toEqual({ saved: true });
    expect(sent[1]).toEqual({ type: "response.create" });
  });

  it("reports when memory is off", () => {
    const { router, sent } = setup(false);
    router.handle({
      type: "response.done",
      response: { output: [{ type: "function_call", name: "remember_preference", call_id: "c2", arguments: '{"fact":"x"}' }] },
    });
    expect(JSON.parse((sent[0].item as { output: string }).output).saved).toBe(false);
  });

  it("ignores benign cancel errors but surfaces real ones", () => {
    const { router, cb } = setup();
    router.handle({ type: "error", error: { code: "response_cancel_not_active", message: "x" } });
    expect(cb.onError).not.toHaveBeenCalled();
    router.handle({ type: "error", error: { message: "boom" } });
    expect(cb.onError).toHaveBeenCalledWith("boom", false);
  });

  it("ignores malformed messages", () => {
    const { router, states } = setup();
    router.handle("not json");
    expect(states).toEqual([]);
  });
});
