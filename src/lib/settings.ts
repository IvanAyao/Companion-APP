/**
 * User-facing companion settings. Persisted in localStorage on the device
 * (no account system yet) and sent to the server when a session is created,
 * where they are validated again before reaching the model.
 */

export const VOICES = [
  { id: "marin", label: "Marin — warm, natural" },
  { id: "cedar", label: "Cedar — calm, grounded" },
  { id: "alloy", label: "Alloy — neutral" },
  { id: "ash", label: "Ash — clear, upbeat" },
  { id: "ballad", label: "Ballad — gentle" },
  { id: "coral", label: "Coral — bright" },
  { id: "sage", label: "Sage — thoughtful" },
  { id: "shimmer", label: "Shimmer — soft" },
  { id: "verse", label: "Verse — expressive" },
] as const;

export type VoiceId = (typeof VOICES)[number]["id"];

export type ThemePreference = "system" | "light" | "dark";

export interface PersonalityPrefs {
  /** 0 = reserved, 100 = very warm and encouraging */
  warmth: number;
  /** 0 = serious, 100 = playful with light humour */
  playfulness: number;
  /** 0 = very brief, 100 = detailed explanations */
  verbosity: number;
  /** 0 = casual, 100 = polished/formal */
  formality: number;
}

export interface CompanionSettings {
  assistantName: string;
  userName: string;
  voice: VoiceId;
  personality: PersonalityPrefs;
  /** Opt-in: allow the companion to save and recall preferences. */
  memoryEnabled: boolean;
  theme: ThemePreference;
}

export const DEFAULT_SETTINGS: CompanionSettings = {
  assistantName: "Nova",
  userName: "",
  voice: "marin",
  personality: { warmth: 75, playfulness: 45, verbosity: 35, formality: 30 },
  memoryEnabled: false,
  theme: "system",
};

const NAME_MAX = 32;

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/** Strip control chars / prompt-structure characters and cap length. */
export function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f<>{}[\]`#*_\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
  return cleaned;
}

/** Coerce arbitrary (untrusted) input into a valid settings object. */
export function sanitizeSettings(input: unknown): CompanionSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const p = (raw.personality && typeof raw.personality === "object"
    ? raw.personality
    : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const voice = VOICES.some((v) => v.id === raw.voice) ? (raw.voice as VoiceId) : d.voice;
  const theme: ThemePreference =
    raw.theme === "light" || raw.theme === "dark" || raw.theme === "system" ? raw.theme : d.theme;
  return {
    assistantName: sanitizeName(raw.assistantName, d.assistantName) || d.assistantName,
    userName: sanitizeName(raw.userName, ""),
    voice,
    personality: {
      warmth: clamp(p.warmth, 0, 100, d.personality.warmth),
      playfulness: clamp(p.playfulness, 0, 100, d.personality.playfulness),
      verbosity: clamp(p.verbosity, 0, 100, d.personality.verbosity),
      formality: clamp(p.formality, 0, 100, d.personality.formality),
    },
    memoryEnabled: raw.memoryEnabled === true,
    theme,
  };
}

const STORAGE_KEY = "companion.settings.v1";

export function loadSettings(): CompanionSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: CompanionSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable (private mode) — settings just won't persist */
  }
}
