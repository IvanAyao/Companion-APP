import { describe, expect, it } from "vitest";
import { mouthFromSpectrum, rmsLevel, smoothMouth, CLOSED_MOUTH } from "@/lib/audio/lipsync";

const SR = 48000;
const BINS = 512; // fftSize 1024
const binHz = SR / 2 / BINS;

function spectrum(bands: [number, number, number][]): Uint8Array {
  const out = new Uint8Array(BINS);
  for (const [lo, hi, v] of bands) for (let i = Math.floor(lo / binHz); i <= Math.ceil(hi / binHz); i++) out[i] = v;
  return out;
}

describe("mouthFromSpectrum", () => {
  it("keeps the mouth closed on silence", () => {
    const m = mouthFromSpectrum(new Uint8Array(BINS), SR);
    expect(m.open).toBe(0);
    expect(m.wide).toBe(0);
  });

  it("opens more for louder voiced sound", () => {
    const quiet = mouthFromSpectrum(spectrum([[80, 2600, 90]]), SR);
    const loud = mouthFromSpectrum(spectrum([[80, 2600, 220]]), SR);
    expect(loud.open).toBeGreaterThan(quiet.open);
    expect(loud.open).toBeLessThanOrEqual(1);
  });

  it("is wider for F2-heavy (ee) sounds than low-heavy (oo) sounds", () => {
    const ee = mouthFromSpectrum(spectrum([[80, 700, 120], [700, 2600, 220]]), SR);
    const oo = mouthFromSpectrum(spectrum([[80, 700, 230], [700, 2600, 40]]), SR);
    expect(ee.wide).toBeGreaterThan(oo.wide);
    expect(oo.wide).toBeLessThan(0);
  });

  it("keeps the mouth mostly closed for sibilants", () => {
    const vowel = mouthFromSpectrum(spectrum([[80, 700, 200], [700, 2600, 150]]), SR);
    const s = mouthFromSpectrum(spectrum([[80, 700, 20], [3500, 8000, 200]]), SR);
    expect(s.open).toBeLessThan(vowel.open);
  });
});

describe("smoothMouth", () => {
  it("moves toward the target without overshooting", () => {
    const next = smoothMouth(CLOSED_MOUTH, { open: 1, wide: 0.5, energy: 1 }, 1 / 60);
    expect(next.open).toBeGreaterThan(0);
    expect(next.open).toBeLessThan(1);
  });
});

describe("rmsLevel", () => {
  it("is 0 for silence (128 = zero in byte time-domain data)", () => {
    expect(rmsLevel(new Uint8Array(256).fill(128))).toBe(0);
  });
  it("is high for a full-scale signal", () => {
    const sq = Uint8Array.from({ length: 256 }, (_, i) => (i % 2 ? 255 : 0));
    expect(rmsLevel(sq)).toBe(1);
  });
});
