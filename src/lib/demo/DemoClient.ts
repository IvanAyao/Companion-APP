import { StreamAnalyser } from "../audio/StreamAnalyser";
import { CLOSED_MOUTH, type MouthShape } from "../audio/lipsync";
import type { CompanionSettings } from "../settings";
import type { ConversationCallbacks, ConversationClient, ConversationState } from "../realtime/types";

/**
 * DEMO MODE — a scripted, offline stand-in for the live AI.
 *
 * Lets you try the full avatar experience (listening reactions, turn-taking,
 * speaking animation, captions, interruption) without an OpenAI key. It does
 * NOT understand what you say: it detects when you speak with a simple
 * volume-based voice detector and replies with canned lines using the
 * browser's built-in speech synthesis.
 */

const SCRIPT = (name: string) => [
  `Hi there! I'm ${name}. This is demo mode, so I can't actually understand you yet, but I can show you how I move and talk.`,
  "When the server has an OpenAI key, I'll be powered by a real-time voice model, and we can have a proper conversation.",
  "Try interrupting me while I'm talking. Just start speaking, or tap me, and I'll stop to listen. Go on, give it a try, I really don't mind at all.",
  "Nice! Notice how I lean in and my eyes widen when I hear you? That's my listening face.",
  "You can change my name, voice and personality in settings. That little gear in the corner.",
  "That's about all I can do in demo mode. Add an API key to bring me fully to life!",
];

const SPEECH_THRESHOLD = 0.07;
const SPEECH_START_MS = 180;
const SILENCE_END_MS = 900;

export class DemoClient implements ConversationClient {
  readonly kind = "demo" as const;
  private state: ConversationState = "idle";
  private ctx: AudioContext | null = null;
  private mic: MediaStream | null = null;
  private micAnalyser: StreamAnalyser | null = null;
  private muted = false;
  private line = 0;
  private timers: number[] = [];
  private raf = 0;
  private speakStart = 0;
  private wordPulse = 0;
  private aboveSince = 0;
  private belowSince = 0;
  private utteranceSeq = 0;
  private useTts = typeof window !== "undefined" && "speechSynthesis" in window;

  constructor(
    private settings: CompanionSettings,
    private cb: ConversationCallbacks,
  ) {}

  private setState(s: ConversationState) {
    if (s === this.state) return;
    this.state = s;
    this.cb.onState(s);
  }

  async start() {
    this.setState("connecting");
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    void this.ctx.resume();
    if (this.useTts) {
      // Unlock speech on iOS by speaking an empty utterance within the gesture.
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
    try {
      this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.micAnalyser = new StreamAnalyser(this.ctx, this.mic, 512);
    } catch {
      this.cb.onError("Demo mode works without a mic — tap the character to hear the next line.", false);
    }
    if (this.state === "idle") return; // stopped while waiting for permission
    this.setState("listening");
    this.loop();
    this.later(() => this.say(), 400);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  /** Volume-based turn detection, running every frame. */
  private loop = () => {
    const now = performance.now();
    const level = this.muted ? 0 : (this.micAnalyser?.level() ?? 0);
    // Higher bar while talking so our own TTS leaking into the mic isn't a barge-in.
    const threshold = this.state === "speaking" ? SPEECH_THRESHOLD * 3 : SPEECH_THRESHOLD;
    if (level > threshold) {
      this.belowSince = 0;
      if (!this.aboveSince) this.aboveSince = now;
      if (now - this.aboveSince > SPEECH_START_MS && this.state !== "hearing") {
        if (this.state === "speaking" || this.state === "thinking") this.cancelSpeech(); // barge-in
        this.setState("hearing");
      }
    } else {
      this.aboveSince = 0;
      if (this.state === "hearing") {
        if (!this.belowSince) this.belowSince = now;
        if (now - this.belowSince > SILENCE_END_MS) {
          this.belowSince = 0;
          this.cb.onTranscript({ id: `u${now}`, role: "user", text: "(demo mode can't transcribe speech)", final: true, at: Date.now() });
          this.setState("thinking");
          this.later(() => this.say(), 700);
        }
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private say() {
    if (this.state === "idle" || this.state === "hearing") return;
    const lines = SCRIPT(this.settings.assistantName);
    const text = lines[this.line % lines.length];
    this.line += 1;
    const id = `a${++this.utteranceSeq}`;
    const seq = this.utteranceSeq;
    this.speakStart = performance.now();
    this.setState("speaking");

    const finish = () => {
      if (seq !== this.utteranceSeq || this.state !== "speaking") return;
      this.cb.onTranscript({ id, role: "assistant", text, final: true, at: Date.now() });
      this.setState("listening");
    };

    // Reveal captions word-by-word as they're "spoken".
    const words = text.split(" ");
    const msPerWord = 330;
    words.forEach((_, i) =>
      this.later(() => {
        if (seq !== this.utteranceSeq || this.state !== "speaking") return;
        this.wordPulse = performance.now();
        this.cb.onTranscript({ id, role: "assistant", text: words.slice(0, i + 1).join(" "), final: false, at: Date.now() });
      }, i * msPerWord),
    );

    const voices = this.useTts ? speechSynthesis.getVoices() : [];
    if (this.useTts && voices.length > 0) {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voices.find((v) => v.lang.startsWith("en") && /natural|samantha|google/i.test(v.name)) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
      u.rate = 1.02;
      u.onboundary = () => (this.wordPulse = performance.now());
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    } else {
      // No TTS voices (e.g. headless browser) — animate silently on a timer.
      this.later(finish, words.length * msPerWord + 300);
    }
  }

  private cancelSpeech() {
    this.utteranceSeq += 1;
    if (this.useTts) speechSynthesis.cancel();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** Tap: interrupt if speaking, otherwise advance the script (useful without a mic). */
  interrupt() {
    if (this.state === "speaking") {
      this.cancelSpeech();
      this.setState("listening");
    } else if (this.state === "listening") {
      this.setState("thinking");
      this.later(() => this.say(), 500);
    }
  }

  /** Synthetic mouth: syllable-rate oscillation plus a bump on each word. */
  sampleMouth(): MouthShape {
    if (this.state !== "speaking") return CLOSED_MOUTH;
    const t = (performance.now() - this.speakStart) / 1000;
    const sinceWord = (performance.now() - this.wordPulse) / 1000;
    const syllable = Math.abs(Math.sin(t * 10.5)) * (0.55 + 0.45 * Math.sin(t * 2.3 + 1));
    const bump = Math.exp(-sinceWord * 9) * 0.35;
    const open = Math.min(1, 0.12 + syllable * 0.6 + bump);
    return { open, wide: Math.sin(t * 3.7) * 0.6, energy: 0.3 + syllable * 0.5 };
  }

  sampleMic(): number {
    return this.muted ? 0 : (this.micAnalyser?.level() ?? 0);
  }

  stop() {
    this.utteranceSeq += 1;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    cancelAnimationFrame(this.raf);
    if (this.useTts) speechSynthesis.cancel();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.micAnalyser?.dispose();
    void this.ctx?.close().catch(() => {});
    this.mic = null;
    this.micAnalyser = null;
    this.ctx = null;
    this.setState("idle");
  }
}
