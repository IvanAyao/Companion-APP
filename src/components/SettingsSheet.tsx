"use client";

import { useEffect, useRef } from "react";
import { VOICES, sanitizeName, type CompanionSettings, type PersonalityPrefs, type ThemePreference } from "@/lib/settings";
import type { MemoryItem } from "@/lib/memory";
import { CloseIcon } from "./Icons";

/** While typing: drop disallowed characters but keep spaces (full trim happens on blur/server). */
const typingName = (v: string) => v.replace(/[\u0000-\u001f\u007f<>{}[\]`#*_\\]/g, "").replace(/\s{2,}/g, " ").slice(0, 32);

interface Props {
  open: boolean;
  onClose: () => void;
  settings: CompanionSettings;
  onChange: (s: CompanionSettings) => void;
  memories: MemoryItem[];
  onDeleteMemory: (id: string) => void;
  onClearMemories: () => void;
  inConversation: boolean;
  accessCodeRequired: boolean;
  accessCode: string;
  onAccessCode: (code: string) => void;
}

const SLIDERS: { key: keyof PersonalityPrefs; label: string; low: string; high: string }[] = [
  { key: "warmth", label: "Warmth", low: "Reserved", high: "Very warm" },
  { key: "playfulness", label: "Playfulness", low: "Serious", high: "Playful" },
  { key: "verbosity", label: "Detail", low: "Brief", high: "Detailed" },
  { key: "formality", label: "Style", low: "Casual", high: "Polished" },
];

export function SettingsSheet(p: Props) {
  const { settings: s, onChange } = p;
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(p.onClose);
  onCloseRef.current = p.onClose;

  useEffect(() => {
    if (!p.open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.open]);

  const set = (patch: Partial<CompanionSettings>) => onChange({ ...s, ...patch });

  return (
    <div className={`sheet-backdrop ${p.open ? "open" : ""}`} onClick={p.onClose} aria-hidden={!p.open}>
      <section
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        inert={!p.open}
      >
        <div className="sheet-handle" />
        <header className="sheet-header">
          <h2 id="settings-title">Settings</h2>
          <button ref={closeRef} className="icon-btn" onClick={p.onClose} aria-label="Close settings">
            <CloseIcon />
          </button>
        </header>

        {p.inConversation && <p className="note">Changes to name, voice and personality apply to your next conversation.</p>}

        <div className="field-group">
          <label className="field">
            <span>Companion name</span>
            <input
              value={s.assistantName}
              maxLength={32}
              onChange={(e) => set({ assistantName: typingName(e.target.value) })}
              onBlur={() => set({ assistantName: sanitizeName(s.assistantName, "") || "Nova" })}
            />
          </label>
          <label className="field">
            <span>What should they call you?</span>
            <input
              value={s.userName}
              placeholder="Optional"
              maxLength={32}
              onChange={(e) => set({ userName: typingName(e.target.value) })}
              onBlur={() => set({ userName: sanitizeName(s.userName, "") })}
            />
          </label>
          <label className="field">
            <span>Voice</span>
            <select value={s.voice} onChange={(e) => set({ voice: e.target.value as CompanionSettings["voice"] })}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h3>Personality</h3>
        <div className="field-group">
          {SLIDERS.map((sl) => (
            <label key={sl.key} className="slider">
              <span className="slider-label">{sl.label}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={s.personality[sl.key]}
                onChange={(e) => set({ personality: { ...s.personality, [sl.key]: Number(e.target.value) } })}
              />
              <span className="slider-ends">
                <span>{sl.low}</span>
                <span>{sl.high}</span>
              </span>
            </label>
          ))}
        </div>

        <h3>Memory</h3>
        <div className="field-group">
          <label className="toggle">
            <span>
              <strong>Remember things about me</strong>
              <small>Your companion can save preferences you share. Stored only on this device; you can delete them anytime.</small>
            </span>
            <input type="checkbox" role="switch" checked={s.memoryEnabled} onChange={(e) => set({ memoryEnabled: e.target.checked })} />
          </label>
          {p.memories.length > 0 && (
            <ul className="memory-list">
              {p.memories.map((m) => (
                <li key={m.id}>
                  <span>{m.text}</span>
                  <button className="icon-btn small" onClick={() => p.onDeleteMemory(m.id)} aria-label={`Forget: ${m.text}`}>
                    <CloseIcon size={16} />
                  </button>
                </li>
              ))}
              <li>
                <button className="text-btn danger" onClick={p.onClearMemories}>
                  Forget everything
                </button>
              </li>
            </ul>
          )}
          {s.memoryEnabled && p.memories.length === 0 && <p className="note">Nothing saved yet.</p>}
        </div>

        <h3>Appearance</h3>
        <div className="segmented" role="radiogroup" aria-label="Theme">
          {(["system", "light", "dark"] as ThemePreference[]).map((t) => (
            <button key={t} role="radio" aria-checked={s.theme === t} className={s.theme === t ? "active" : ""} onClick={() => set({ theme: t })}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {p.accessCodeRequired && (
          <>
            <h3>Access</h3>
            <div className="field-group">
              <label className="field">
                <span>Beta access code</span>
                <input type="password" value={p.accessCode} onChange={(e) => p.onAccessCode(e.target.value)} autoComplete="off" />
              </label>
            </div>
          </>
        )}

        <p className="fine-print">
          Voice audio is streamed to OpenAI to generate responses. Your companion is an AI and can make mistakes.
        </p>
      </section>
    </div>
  );
}
