/**
 * Lightweight, real-time lip-sync from an audio spectrum.
 *
 * We don't get phoneme timings from the realtime API audio track, so we
 * approximate mouth shapes from what the voice *sounds* like right now:
 *   - loudness            → how open the jaw is
 *   - low vs. mid energy  → rounded ("oo", "oh") vs. wide ("ee", "ah")
 *   - high-band energy    → sibilants ("s", "sh", "f") — teeth, narrow opening
 * This runs every animation frame on an AnalyserNode and is cheap enough for
 * phones. It is a deliberate MVP approach; see docs/ROADMAP.md for upgrades.
 */

export interface MouthShape {
  /** 0 closed → 1 fully open */
  open: number;
  /** -1 rounded/pursed → 0 neutral → 1 wide/smile */
  wide: number;
  /** overall voice energy, 0..1 (drives brows/head bob) */
  energy: number;
}

export const CLOSED_MOUTH: MouthShape = { open: 0, wide: 0, energy: 0 };

function bandEnergy(bins: ArrayLike<number>, binHz: number, lo: number, hi: number): number {
  const start = Math.max(0, Math.floor(lo / binHz));
  const end = Math.min(bins.length - 1, Math.ceil(hi / binHz));
  if (end < start) return 0;
  let sum = 0;
  for (let i = start; i <= end; i++) sum += bins[i];
  return sum / (end - start + 1);
}

/**
 * @param bins byte frequency data (0..255) from AnalyserNode.getByteFrequencyData
 * @param sampleRate AudioContext sample rate
 */
export function mouthFromSpectrum(bins: ArrayLike<number>, sampleRate: number): MouthShape {
  if (bins.length === 0) return CLOSED_MOUTH;
  const binHz = sampleRate / 2 / bins.length;
  const low = bandEnergy(bins, binHz, 80, 700) / 255; // F1 region / voicing
  const mid = bandEnergy(bins, binHz, 700, 2600) / 255; // F2 region
  const high = bandEnergy(bins, binHz, 3500, 8000) / 255; // fricatives

  const energy = Math.min(1, low * 0.6 + mid * 0.3 + high * 0.1);
  // Noise gate + gentle curve so quiet breaths don't flap the mouth.
  const gated = Math.max(0, energy - 0.08) / 0.92;
  let open = Math.min(1, Math.pow(gated, 0.75) * 1.5);

  // Sibilants: noisy high band with little voicing → mostly-closed, wide mouth.
  const sibilance = high > 0.12 && high > low * 0.9 ? Math.min(1, (high - low * 0.5) * 2) : 0;
  open *= 1 - 0.6 * sibilance;

  // Front vowels push energy up into F2 (wide); back vowels sit low (round).
  const total = low + mid + 1e-4;
  const tilt = (mid / total - 0.35) * 3; // ~-1..1
  const wide = Math.max(-1, Math.min(1, tilt + sibilance * 0.5));

  return { open, wide: open > 0.02 || sibilance > 0 ? wide : 0, energy };
}

/** Attack/release smoothing so the mouth snaps open but relaxes naturally. */
export function smoothMouth(prev: MouthShape, target: MouthShape, dt: number): MouthShape {
  const k = (rate: number) => 1 - Math.exp(-rate * dt);
  const openRate = target.open > prev.open ? 28 : 14;
  return {
    open: prev.open + (target.open - prev.open) * k(openRate),
    wide: prev.wide + (target.wide - prev.wide) * k(10),
    energy: prev.energy + (target.energy - prev.energy) * k(12),
  };
}

/** RMS level (0..1) of time-domain byte data — used for the mic "listening" meter. */
export function rmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = (samples[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}
