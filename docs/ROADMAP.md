# Roadmap

## Phase 1: MVP ✅ (this repo)

The details are in the README's status table. In short: a procedural 3D character, live voice over WebRTC, interruptions, captions, personalization, opt-in on-device memory, demo mode, light/dark themes and secure ephemeral tokens.

**First thing to do next:** run it with a real `OPENAI_API_KEY` on a phone (Vercel preview URL) and tune these:
- `mouthFromSpectrum` gain and gate in `src/lib/audio/lipsync.ts`, by watching real voice output
- VAD `eagerness` in `src/app/api/session/route.ts` (`low` gives fewer accidental interruptions in noisy rooms)
- Camera framing in `AvatarCanvas.tsx` on a few screen sizes

## Phase 2: Improvements

| Item | Approach |
|---|---|
| **Better lip-sync** | Option A: run a small viseme classifier (MFCC → 15 Oculus visemes) on the remote audio in an AudioWorklet. Option B: use a TTS pipeline that returns viseme timings (e.g. Azure Speech) — but that gives up the speech-to-speech latency. A is recommended. |
| **Facial expressions** | Have the model emit an `[emotion]` tag through a lightweight `set_expression` tool, or classify the transcript with a tiny model. Blend into the existing `EXPRESSIONS` table. |
| **Art upgrade** | Commission a rigged GLB character with ARKit-style blendshapes (jawOpen, mouthFunnel, mouthSmile, eyeBlink…). Load it with `useGLTF` and map `AvatarSignals` onto morph targets. The current procedural character stays as the fallback. |
| **More animations** | Gestures (wave on greet, shrug, nod/shake on yes/no), idle variety, and a sleep pose after inactivity. |
| **Conversation history** | Store transcripts per session (IndexedDB first, then server-side with accounts). Add a history screen, "continue where we left off" summaries, and delete/export controls. |
| **Personalization** | Multiple personas (preset prompt + voice + palette), plus avatar colour and accessories. |
| **Text input fallback** | Send `conversation.item.create` with text for quiet environments. |

## Phase 3: Product launch

### Accounts and data
- Auth: **Clerk** or **Supabase Auth** with Sign in with Apple, which Apple requires if you offer any other social login on iOS.
- Database: **Supabase Postgres** or **Neon** for users, personas, memories (encrypted at rest) and conversation history.
- Move memories from `localStorage` to the server per user. Keep explicit consent, plus view, edit and delete for every memory and one-tap "delete all my data".

### Production hardening
- Replace the in-memory rate limiter with **Upstash Redis**. Enforce per-user minute quotas on the server before minting a token.
- Track session minutes using the Realtime `response.done` usage fields, sent from the client and validated, or use the server-side WebRTC "sideband" connection so usage is authoritative.
- Run OpenAI moderation on transcripts, give age-appropriate defaults and show crisis-resource messaging.
- Monitoring with Sentry, plus usage dashboards and cost alerts.

### Subscription model (suggested)
| Tier | Price | Includes |
|---|---|---|
| Free | $0 | 15 voice minutes/month (mini model), 1 persona |
| Plus | $9.99/mo | 300 minutes, memory, history, all voices |
| Pro | $19.99/mo | 1,000 minutes, flagship model, custom personas/avatars |

At an estimated ~$0.03/min (mini) to ~$0.10/min (flagship), Plus costs about $9 worst-case if every minute is used (typical use is far lower). Watch the margins and adjust the minute caps. Use **Stripe** on the web. On iOS you must use **Apple In-App Purchase** for digital subscriptions (via StoreKit 2 / **RevenueCat**). Apple takes 15–30%.

### iOS app plan
Two paths, cheapest first:

1. **Capacitor wrapper (2–4 weeks).** Ship this exact web app in a native shell.
   - `npx cap add ios`. Handle the mic in WKWebView (`NSMicrophoneUsageDescription`). Configure the audio session (`.playAndRecord`, `.voiceChat` mode for echo cancellation). Add RevenueCat for IAP.
   - Risk: App Review guideline 4.2 ("minimum functionality") rejects thin web wrappers. Add native value such as push reminders, widgets, haptics, Siri Shortcuts and offline settings.
2. **Native SwiftUI app (8–12 weeks).** Best quality, and the long-term recommendation.
   - Voice: WebRTC iOS SDK (or OpenAI's Swift/Agents SDK if available) against the same `/api/session` endpoint, which is reused unchanged.
   - Avatar: **RealityKit** with the GLB/USDZ character from Phase 2. Drive blendshapes from `AVAudioEngine` tap → the same lip-sync algorithm, ported.
   - Background audio, CallKit-style interruptions, AirPods routing.

### App Store requirements checklist
- Apple Developer Program ($99/yr), App Store Connect listing, screenshots (6.9" & 6.5"), app preview video.
- **Privacy:** privacy policy URL, App Privacy "nutrition label" (audio data sent to a third-party AI provider, used for app functionality, not tracking), `NSMicrophoneUsageDescription`.
- **AI disclosure:** make it clear the user is talking to an AI. Guideline 5.1.2(i) (data sharing with third-party AI) needs explicit user consent before personal data is sent to OpenAI. Add a first-run consent screen.
- **Age rating:** a generative-AI chat app is likely 13+ or higher. Add content filtering.
- **Account deletion** in-app if accounts exist (Guideline 5.1.1(v)).
- **Sign in with Apple** if other social logins are offered.
- **IAP** for all digital subscriptions; include restore purchases.
- **Terms of service** and **EULA**, plus an emotional-wellbeing/safety policy (companion apps get scrutiny).

## Phase 3 budget snapshot (monthly, early launch)

| Item | Cost |
|---|---|
| OpenAI realtime (1k active users, ~2h each, mini model) | ~$2.4k–6k |
| Vercel Pro | $20/seat |
| Supabase / Neon | $0–25 |
| Upstash Redis | $0–10 |
| Clerk (≤10k MAU) | $0–25 |
| RevenueCat | free up to $2.5k MTR, then 1% |
| Sentry | $0–26 |
| Apple Developer | $8.25 (amortized) |

Voice usage is >90% of the cost, so minute caps per tier are the key lever.
