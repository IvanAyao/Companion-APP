"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSignals } from "./avatar/signals";
import { SettingsSheet } from "./SettingsSheet";
import { CaptionsIcon, GearIcon, MicIcon, MicOffIcon, PhoneOffIcon } from "./Icons";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type CompanionSettings } from "@/lib/settings";
import { addMemory, clearMemories, loadMemories, saveMemories, type MemoryItem } from "@/lib/memory";
import { expressionForState } from "@/lib/expression";
import { RealtimeClient } from "@/lib/realtime/RealtimeClient";
import { DemoClient } from "@/lib/demo/DemoClient";
import type { ConversationClient, ConversationState, TranscriptEntry } from "@/lib/realtime/types";

// WebGL only runs in the browser.
const AvatarCanvas = dynamic(() => import("./avatar/AvatarCanvas"), {
  ssr: false,
  loading: () => <div className="avatar-loading" aria-hidden />,
});

interface Health {
  liveVoice: boolean;
  accessCodeRequired: boolean;
}

const ACCESS_KEY = "companion.accessCode";

function statusText(state: ConversationState, name: string, muted: boolean, demo: boolean): string {
  switch (state) {
    case "idle":
      return `Tap ${name} to start talking`;
    case "connecting":
      return "Connecting…";
    case "listening":
      return muted ? "You're muted" : demo ? "Listening… (demo)" : "Listening…";
    case "hearing":
      return "I'm listening";
    case "thinking":
      return "Thinking…";
    case "speaking":
      return "Speaking — tap or talk to interrupt";
    case "error":
      return "Something went wrong";
  }
}

export default function CompanionApp() {
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_SETTINGS);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [state, setState] = useState<ConversationState>("idle");
  const [mode, setMode] = useState<"live" | "demo" | null>(null);
  const [muted, setMuted] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const signals = useMemo(createSignals, []);
  const clientRef = useRef<ConversationClient | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const lastAssistantText = useRef("");
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  // ---- load persisted state & server capabilities ----
  useEffect(() => {
    setSettings(loadSettings());
    setMemories(loadMemories());
    try {
      setAccessCode(localStorage.getItem(ACCESS_KEY) ?? "");
    } catch {
      /* ignore */
    }
    setHydrated(true);
    fetch("/api/health")
      .then((r) => r.json())
      .then((h: Health) => setHealth(h))
      .catch(() => setHealth({ liveVoice: false, accessCodeRequired: false }));
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    signals.reducedMotion = mq.matches;
    const onMq = () => (signals.reducedMotion = mq.matches);
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, [signals]);

  useEffect(() => {
    if (hydrated) saveSettings(settings);
  }, [settings, hydrated]);

  // ---- theme ----
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  // ---- keep avatar signals in sync ----
  useEffect(() => {
    signals.state = state;
    signals.expression = expressionForState(state, lastAssistantText.current);
    signals.muted = muted;
  }, [signals, state, muted]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000);
  }, []);

  const releaseWakeLock = () => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  };

  const end = useCallback(() => {
    clientRef.current?.stop();
    clientRef.current = null;
    signals.sampleMouth = () => ({ open: 0, wide: 0, energy: 0 });
    signals.sampleMic = () => 0;
    setMode(null);
    setMuted(false);
    setState("idle");
    releaseWakeLock();
  }, [signals]);

  const start = useCallback(
    (kind: "live" | "demo") => {
      if (clientRef.current) return;
      setTranscript([]);
      lastAssistantText.current = "";
      const callbacks = {
        onState: (s: ConversationState) => setState(s),
        onTranscript: (entry: TranscriptEntry) => {
          if (entry.role === "assistant") {
            lastAssistantText.current = entry.text;
            signals.expression = expressionForState(signals.state, entry.text);
          }
          setTranscript((prev) => {
            const i = prev.findIndex((e) => e.id === entry.id);
            if (i === -1) return [...prev, entry].slice(-50);
            const next = prev.slice();
            next[i] = entry;
            return next;
          });
        },
        onRemember: (fact: string) => {
          if (!settingsRef.current.memoryEnabled) return false;
          setMemories((prev) => {
            const next = addMemory(prev, fact);
            saveMemories(next);
            return next;
          });
          showToast(`Remembered: ${fact}`);
          return true;
        },
        onError: (message: string, fatal: boolean) => {
          showToast(message);
          if (fatal) end();
        },
      };
      const client: ConversationClient =
        kind === "live"
          ? new RealtimeClient(
              {
                settings: settingsRef.current,
                memories: settingsRef.current.memoryEnabled ? memories.map((m) => m.text) : [],
                accessCode,
              },
              callbacks,
            )
          : new DemoClient(settingsRef.current, callbacks);
      clientRef.current = client;
      signals.sampleMouth = () => client.sampleMouth();
      signals.sampleMic = () => client.sampleMic();
      setMode(kind);
      void navigator.wakeLock
        ?.request("screen")
        .then((l) => (wakeLock.current = l))
        .catch(() => {});
      void client.start();
    },
    [accessCode, end, memories, showToast, signals],
  );

  useEffect(() => () => clientRef.current?.stop(), []);

  const liveAvailable = health?.liveVoice ?? false;
  const active = state !== "idle" && state !== "error";

  const onAvatarTap = () => {
    if (!active) {
      if (health) start(liveAvailable ? "live" : "demo");
    } else {
      clientRef.current?.interrupt();
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    clientRef.current?.setMuted(next);
  };

  const recent = captionsOn ? transcript.filter((t) => t.text).slice(-2) : [];

  return (
    <main className={`app state-${state}`}>
      <header className="topbar">
        <div className="title">
          <h1>{settings.assistantName}</h1>
          <p className="status" aria-live="polite">
            <span className={`dot ${state}`} aria-hidden />
            {statusText(state, settings.assistantName, muted, mode === "demo")}
          </p>
        </div>
        <div className="top-actions">
          <button
            className={`icon-btn ${captionsOn ? "on" : ""}`}
            onClick={() => setCaptionsOn((v) => !v)}
            aria-pressed={captionsOn}
            aria-label="Captions"
          >
            <CaptionsIcon />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <GearIcon />
          </button>
        </div>
      </header>

      {health && !liveAvailable && (
        <div className="banner" role="note">
          <strong>Demo mode.</strong> Live AI voice needs an OpenAI API key on the server — see README.
        </div>
      )}

      <button
        className="stage"
        onClick={onAvatarTap}
        aria-label={active ? (state === "speaking" ? "Interrupt" : `${settings.assistantName}`) : `Start talking to ${settings.assistantName}`}
      >
        <div className="aura" aria-hidden />
        <AvatarCanvas signals={signals} />
      </button>

      <section className="captions" aria-live="polite" aria-label="Captions">
        {recent.map((t) => (
          <p key={t.id} className={`caption ${t.role}`}>
            {t.text}
          </p>
        ))}
      </section>

      <footer className="controls">
        {!active ? (
          <div className="start-row">
            <button className="primary" onClick={() => start(liveAvailable ? "live" : "demo")} disabled={!health}>
              {health ? (liveAvailable ? "Start conversation" : "Try the demo") : "Loading…"}
            </button>
            {liveAvailable && (
              <button className="text-btn" onClick={() => start("demo")}>
                Try offline demo
              </button>
            )}
          </div>
        ) : (
          <div className="call-row">
            <button
              className={`round ${muted ? "muted" : ""}`}
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              disabled={state === "connecting"}
            >
              {muted ? <MicOffIcon size={26} /> : <MicIcon size={26} />}
            </button>
            <button className="round end" onClick={end} aria-label="End conversation">
              <PhoneOffIcon size={28} />
            </button>
          </div>
        )}
      </footer>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={setSettings}
        memories={memories}
        onDeleteMemory={(id) =>
          setMemories((prev) => {
            const next = prev.filter((m) => m.id !== id);
            saveMemories(next);
            return next;
          })
        }
        onClearMemories={() => {
          clearMemories();
          setMemories([]);
        }}
        inConversation={active}
        accessCodeRequired={health?.accessCodeRequired ?? false}
        accessCode={accessCode}
        onAccessCode={(c) => {
          setAccessCode(c);
          try {
            localStorage.setItem(ACCESS_KEY, c);
          } catch {
            /* ignore */
          }
        }}
      />
    </main>
  );
}
