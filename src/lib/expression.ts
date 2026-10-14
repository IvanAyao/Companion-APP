import type { ConversationState, Expression } from "./realtime/types";

/**
 * Cheap text-based expression cues from the assistant's live transcript.
 * Good enough for an MVP; a later phase can have the model emit explicit
 * emotion tags or use a small classifier.
 */
const HAPPY = /\b(great|awesome|love|glad|wonderful|amazing|haha|fun|congrat\w*|nice|happy|excited|yay|fantastic|delight\w*)\b|!/i;
const CONCERNED = /\b(sorry|sad|unfortunately|difficult|hard time|worried|tough|hurts?|lonely|stress\w*|anxious)\b/i;
const CURIOUS = /\?|\b(wonder|curious|tell me|what about|how about|really)\b/i;

export function expressionFromText(text: string): Expression {
  // Look at the most recent sentence or so — that's what is being said now.
  const recent = text.slice(-120);
  if (CONCERNED.test(recent)) return "concerned";
  if (HAPPY.test(recent)) return "happy";
  if (CURIOUS.test(recent)) return "curious";
  return "neutral";
}

export function expressionForState(state: ConversationState, spokenText: string): Expression {
  switch (state) {
    case "thinking":
    case "connecting":
      return "thinking";
    case "hearing":
      return "curious";
    case "speaking":
      return expressionFromText(spokenText);
    case "error":
      return "concerned";
    default:
      return "neutral";
  }
}
