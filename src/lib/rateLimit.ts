/**
 * Minimal fixed-window rate limiter kept in memory. On serverless platforms
 * each instance has its own map, so this is a best-effort guard against
 * runaway clients — use a shared store (e.g. Upstash Redis / Vercel KV) once
 * there are real users.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return { ok: true, retryAfterSec: 0 };
    }
    if (entry.count >= this.limit) {
      return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count += 1;
    return { ok: true, retryAfterSec: 0 };
  }

  private prune(now: number) {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
