import type { MouthShape } from "@/lib/audio/lipsync";
import type { ConversationState, Expression } from "@/lib/realtime/types";

/**
 * Mutable bridge between the conversation engine and the 3D scene.
 * The avatar reads this every frame inside useFrame, so 60fps animation
 * data never goes through React state / re-renders.
 */
export interface AvatarSignals {
  state: ConversationState;
  expression: Expression;
  muted: boolean;
  reducedMotion: boolean;
  sampleMouth: () => MouthShape;
  sampleMic: () => number;
}

export function createSignals(): AvatarSignals {
  return {
    state: "idle",
    expression: "neutral",
    muted: false,
    reducedMotion: false,
    sampleMouth: () => ({ open: 0, wide: 0, energy: 0 }),
    sampleMic: () => 0,
  };
}
