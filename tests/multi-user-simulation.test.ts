import { describe, expect, test } from "vitest";
import { ChatEngine } from "@/lib/chat-engine";
import { FakeLlmClient, FakeMemoryClient, percentile } from "./helpers/fakes";

function toTokenRegex(value: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`);
}

describe("multi-user latency simulation", () => {
  test("sustains low p95 latency and preserves user-specific memory", async () => {
    const memoryClient = new FakeMemoryClient({ contextMs: 14, captureMs: 6 });
    const llmClient = new FakeLlmClient(18);
    const engine = new ChatEngine(memoryClient, llmClient);

    const users = Array.from({ length: 10 }, (_, index) => `sim-user-${index + 1}`);
    const sessions = new Map(users.map((userId) => [userId, `sim-session-${userId}`]));
    const latencies: number[] = [];

    for (let turn = 0; turn < 7; turn += 1) {
      const batchResults = await Promise.all(
        users.map((userId) =>
          engine.runTurn({
            userId,
            sessionId: sessions.get(userId)!,
            userMessage:
              turn === 0
                ? `My personal token is ${userId} and I prefer quick summaries.`
                : `Turn ${turn}: remind me of my personal token.`,
          }),
        ),
      );

      for (const result of batchResults) {
        const latency = result.assistantMessage.metrics?.totalLatencyMs ?? 0;
        latencies.push(latency);
      }
    }

    const p95 = percentile(latencies, 95);
    expect(p95).toBeLessThan(120);

    const verification = await Promise.all(
      users.map((userId) =>
        engine.runTurn({
          userId,
          sessionId: sessions.get(userId)!,
          userMessage: "Final check: what is my personal token?",
        }),
      ),
    );

    for (let index = 0; index < verification.length; index += 1) {
      const result = verification[index];
      const expectedUser = users[index];
      const otherUser = users[(index + 1) % users.length];
      const memoryText = result.assistantMessage.usedMemories?.map((entry) => entry.content).join(" ") ?? "";
      expect(memoryText).toMatch(toTokenRegex(expectedUser));
      expect(memoryText).not.toMatch(toTokenRegex(otherUser));
    }
  });
});
