/**
 * Opt-in, on-device memory. The model can *ask* to remember something via the
 * `remember_preference` tool, but the client only stores it when the user has
 * turned memory on. Memories never leave the device except as part of the
 * instructions for the user's own next session.
 */

export interface MemoryItem {
  id: string;
  text: string;
  createdAt: number;
}

export const MEMORY_LIMIT = 30;
export const MEMORY_TEXT_MAX = 200;

const STORAGE_KEY = "companion.memory.v1";

export function sanitizeMemoryText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MEMORY_TEXT_MAX);
}

/** Validate a list of memories coming from untrusted input (client → server). */
export function sanitizeMemories(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    const text = sanitizeMemoryText(typeof item === "string" ? item : (item as MemoryItem)?.text);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MEMORY_LIMIT) break;
  }
  return out;
}

/** Add a memory, de-duplicating and keeping only the newest MEMORY_LIMIT. */
export function addMemory(list: MemoryItem[], text: string, now = Date.now()): MemoryItem[] {
  const clean = sanitizeMemoryText(text);
  if (!clean) return list;
  const filtered = list.filter((m) => m.text.toLowerCase() !== clean.toLowerCase());
  const next = [...filtered, { id: `${now}-${Math.random().toString(36).slice(2, 8)}`, text: clean, createdAt: now }];
  return next.slice(-MEMORY_LIMIT);
}

export function loadMemories(): MemoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is MemoryItem => typeof m?.text === "string" && typeof m?.id === "string")
      .map((m) => ({ ...m, text: sanitizeMemoryText(m.text) }))
      .slice(-MEMORY_LIMIT);
  } catch {
    return [];
  }
}

export function saveMemories(list: MemoryItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function clearMemories(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
