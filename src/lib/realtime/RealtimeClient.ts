import { StreamAnalyser } from "../audio/StreamAnalyser";
import { CLOSED_MOUTH, type MouthShape } from "../audio/lipsync";
import type { CompanionSettings } from "../settings";
import { RealtimeEventRouter } from "./eventRouter";
import type { ConversationCallbacks, ConversationClient } from "./types";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

export interface RealtimeClientOptions {
  settings: CompanionSettings;
  memories: string[];
  accessCode?: string;
}

/**
 * Live voice conversation over WebRTC with the OpenAI Realtime API.
 *
 * Flow:
 *  1. Ask for the microphone (must happen from a user gesture).
 *  2. POST /api/session → our server mints a short-lived client secret.
 *  3. Create an RTCPeerConnection, send the mic track, open the "oai-events"
 *     data channel, and exchange SDP directly with OpenAI using that secret.
 *  4. Remote audio plays through an <audio> element and is also analysed to
 *     drive the avatar's mouth.
 */
export class RealtimeClient implements ConversationClient {
  readonly kind = "live" as const;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private mic: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;
  private outAnalyser: StreamAnalyser | null = null;
  private micAnalyser: StreamAnalyser | null = null;
  private router: RealtimeEventRouter;
  private stopped = false;
  private abort = new AbortController();

  constructor(
    private opts: RealtimeClientOptions,
    private cb: ConversationCallbacks,
  ) {
    this.router = new RealtimeEventRouter(cb, (e) => this.sendEvent(e));
  }

  async start(): Promise<void> {
    this.cb.onState("connecting");

    // Create audio objects synchronously inside the user gesture so iOS Safari
    // allows playback later.
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    void this.ctx.resume();
    this.audioEl = document.createElement("audio");
    this.audioEl.autoplay = true;
    this.audioEl.setAttribute("playsinline", "");
    this.audioEl.style.display = "none";
    document.body.appendChild(this.audioEl);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new FriendlyError("This browser doesn't support microphone access. Try Safari or Chrome over HTTPS.");
      }
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (e) {
        const name = (e as DOMException)?.name;
        throw new FriendlyError(
          name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it in your browser settings to talk."
            : "Couldn't access a microphone.",
        );
      }
      if (this.stopped) return;
      this.micAnalyser = new StreamAnalyser(this.ctx, this.mic, 512);

      const tokenRes = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: this.opts.settings,
          memories: this.opts.memories,
          accessCode: this.opts.accessCode,
        }),
        signal: this.abort.signal,
      });
      const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
        clientSecret?: string;
        error?: { message?: string };
      };
      if (!tokenRes.ok || !tokenJson.clientSecret) {
        throw new FriendlyError(tokenJson.error?.message ?? `Couldn't start a session (${tokenRes.status}).`);
      }
      if (this.stopped) return;

      const pc = new RTCPeerConnection();
      this.pc = pc;
      pc.ontrack = (e) => {
        const [stream] = e.streams;
        if (!stream || !this.audioEl || !this.ctx) return;
        this.audioEl.srcObject = stream;
        void this.audioEl.play().catch(() => {});
        this.outAnalyser?.dispose();
        this.outAnalyser = new StreamAnalyser(this.ctx, stream, 1024);
      };
      pc.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.cb.onError("The connection was lost.", true);
        }
      };
      for (const track of this.mic.getAudioTracks()) pc.addTrack(track, this.mic);

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onmessage = (e) => this.router.handle(e.data as string);
      const opened = new Promise<void>((resolve, reject) => {
        dc.onopen = () => resolve();
        setTimeout(() => reject(new FriendlyError("Timed out connecting to the voice service.")), 15000);
      });
      opened.catch(() => {}); // avoid an unhandled rejection if we bail out earlier

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(REALTIME_CALLS_URL, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${tokenJson.clientSecret}`, "Content-Type": "application/sdp" },
        signal: this.abort.signal,
      });
      if (!sdpRes.ok) {
        throw new FriendlyError(`The voice service refused the connection (${sdpRes.status}).`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      await opened;
      if (this.stopped) return;

      this.cb.onState("listening");
      // Ask the companion to greet the user (instructions describe the greeting).
      this.sendEvent({ type: "response.create" });
    } catch (e) {
      if (this.stopped) return;
      this.teardown();
      const message = e instanceof FriendlyError ? e.message : "Something went wrong starting the conversation.";
      if (!(e instanceof FriendlyError)) console.error(e);
      this.cb.onError(message, true);
    }
  }

  private sendEvent(event: Record<string, unknown>) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(event));
  }

  setMuted(muted: boolean) {
    this.mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  interrupt() {
    if (this.router.current !== "speaking" && this.router.current !== "thinking") return;
    this.sendEvent({ type: "response.cancel" });
    // WebRTC-only: drop audio the server has already queued for playback.
    this.sendEvent({ type: "output_audio_buffer.clear" });
  }

  sampleMouth(): MouthShape {
    return this.router.current === "speaking" && this.outAnalyser ? this.outAnalyser.mouth() : CLOSED_MOUTH;
  }

  sampleMic(): number {
    return this.micAnalyser?.level() ?? 0;
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    this.teardown();
    this.cb.onState("idle");
  }

  private teardown() {
    this.dc?.close();
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.mic?.getTracks().forEach((t) => t.stop());
    this.outAnalyser?.dispose();
    this.micAnalyser?.dispose();
    if (this.audioEl) {
      this.audioEl.srcObject = null;
      this.audioEl.remove();
    }
    void this.ctx?.close().catch(() => {});
    this.pc = this.dc = this.mic = this.audioEl = this.ctx = null;
    this.outAnalyser = this.micAnalyser = null;
  }
}

class FriendlyError extends Error {}
