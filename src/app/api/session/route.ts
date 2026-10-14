import { NextResponse, type NextRequest } from "next/server";
import { buildInstructions, REMEMBER_TOOL } from "@/lib/persona";
import { sanitizeSettings } from "@/lib/settings";
import { sanitizeMemories } from "@/lib/memory";
import { RateLimiter } from "@/lib/rateLimit";

/**
 * POST /api/session
 *
 * Mints a short-lived OpenAI Realtime client secret ("ephemeral key") for the
 * browser. The permanent OPENAI_API_KEY never leaves the server; the browser
 * only receives a token that expires after a few minutes and is locked to the
 * session config chosen here (model, voice, instructions, tools).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limiter = new RateLimiter(Number(process.env.SESSION_RATE_LIMIT) || 20, 10 * 60 * 1000);

const MAX_BODY_BYTES = 16 * 1024;
const TOKEN_TTL_SECONDS = 120; // only needs to live long enough to open the WebRTC call

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function error(status: number, code: string, message: string, extra?: Record<string, string>) {
  return NextResponse.json({ error: { code, message } }, { status, headers: extra });
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return error(503, "not_configured", "Live voice is not configured on this server (missing OPENAI_API_KEY).");
  }

  // Same-origin check: browsers always send Origin on cross-site POSTs.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return error(403, "forbidden_origin", "Cross-origin requests are not allowed.");
  }

  const rl = limiter.check(clientIp(req));
  if (!rl.ok) {
    return error(429, "rate_limited", "Too many sessions. Please wait a moment.", {
      "Retry-After": String(rl.retryAfterSec),
    });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return error(413, "too_large", "Request body too large.");
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    return error(400, "bad_json", "Invalid JSON body.");
  }

  const accessCode = process.env.APP_ACCESS_CODE;
  if (accessCode && body.accessCode !== accessCode) {
    return error(401, "access_code", "A valid access code is required.");
  }

  const settings = sanitizeSettings(body.settings);
  const memories = settings.memoryEnabled ? sanitizeMemories(body.memories) : [];
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";

  const session = {
    type: "realtime",
    model,
    instructions: buildInstructions(settings, memories),
    output_modalities: ["audio"],
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: { model: transcribeModel },
        // Semantic VAD waits for the user to finish a thought and lets them
        // barge in: when speech starts during a reply, the server cancels it.
        turn_detection: { type: "semantic_vad", eagerness: "auto", create_response: true, interrupt_response: true },
      },
      output: { voice: settings.voice },
    },
    tools: settings.memoryEnabled ? [REMEMBER_TOOL] : [],
    tool_choice: "auto",
  };

  try {
    const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: TOKEN_TTL_SECONDS },
        session,
      }),
      cache: "no-store",
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("[api/session] OpenAI client_secrets failed", upstream.status, detail.slice(0, 500));
      return error(502, "upstream_error", `Could not start a voice session (OpenAI returned ${upstream.status}).`);
    }

    const data = (await upstream.json()) as { value?: string; expires_at?: number };
    if (!data.value) return error(502, "upstream_error", "OpenAI did not return a client secret.");

    return NextResponse.json(
      { clientSecret: data.value, expiresAt: data.expires_at ?? null, model },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/session] request error", err);
    return error(502, "upstream_unreachable", "Could not reach OpenAI.");
  }
}
