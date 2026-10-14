import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/lib/rateLimit";
import { expressionForState, expressionFromText } from "@/lib/expression";

describe("RateLimiter", () => {
  it("blocks after the limit within a window and resets after", () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check("ip", 0).ok).toBe(true);
    expect(rl.check("ip", 1).ok).toBe(true);
    const blocked = rl.check("ip", 2);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(rl.check("other", 2).ok).toBe(true);
    expect(rl.check("ip", 1001).ok).toBe(true);
  });
});

describe("expressions", () => {
  it("maps text to expressions", () => {
    expect(expressionFromText("That's wonderful news!")).toBe("happy");
    expect(expressionFromText("I'm sorry you're dealing with that.")).toBe("concerned");
    expect(expressionFromText("What do you think about it?")).toBe("curious");
    expect(expressionFromText("The capital is Paris.")).toBe("neutral");
  });
  it("uses state when not speaking", () => {
    expect(expressionForState("thinking", "yay!")).toBe("thinking");
    expect(expressionForState("hearing", "")).toBe("curious");
    expect(expressionForState("speaking", "yay!")).toBe("happy");
  });
});
