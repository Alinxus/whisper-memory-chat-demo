import { describe, expect, test } from "vitest";
import { ChatEngine } from "@/lib/chat-engine";
import { FakeLlmClient, FakeMemoryClient } from "./helpers/fakes";

describe("ChatEngine", () => {
  test("keeps memory isolated between users", async () => {
    const memoryClient = new FakeMemoryClient();
    const llmClient = new FakeLlmClient();
    const engine = new ChatEngine(memoryClient, llmClient);

    const sessionA = `session-a-${Date.now()}`;
    const sessionB = `session-b-${Date.now()}`;

    await engine.runTurn({
      userId: "user-a",
      sessionId: sessionA,
      userMessage: "I prefer vegetarian food and short answers.",
    });
    await engine.runTurn({
      userId: "user-b",
      sessionId: sessionB,
      userMessage: "I work night shifts and drink coffee after 10pm.",
    });

    const secondTurnA = await engine.runTurn({
      userId: "user-a",
      sessionId: sessionA,
      userMessage: "What lunch should I order?",
    });
    const secondTurnB = await engine.runTurn({
      userId: "user-b",
      sessionId: sessionB,
      userMessage: "How should I plan dinner?",
    });

    const memoriesA = secondTurnA.assistantMessage.usedMemories?.map((item) => item.content).join(" ") ?? "";
    const memoriesB = secondTurnB.assistantMessage.usedMemories?.map((item) => item.content).join(" ") ?? "";

    expect(memoriesA).toContain("vegetarian");
    expect(memoriesB).not.toContain("vegetarian");
    expect(memoriesB).toContain("night shifts");
  });

  test("returns latency metrics and extraction counts", async () => {
    const memoryClient = new FakeMemoryClient({ contextMs: 8, captureMs: 5 });
    const llmClient = new FakeLlmClient(10);
    const engine = new ChatEngine(memoryClient, llmClient);

    const result = await engine.runTurn({
      userId: "metrics-user",
      sessionId: `metrics-${Date.now()}`,
      userMessage: "Remember that I need concise responses.",
    });

    expect(result.assistantMessage.metrics).toBeDefined();
    expect(result.assistantMessage.metrics?.whisperLatencyMs).toBe(13);
    expect(result.assistantMessage.metrics?.memorySearchLatencyMs).toBe(8);
    expect(result.assistantMessage.metrics?.memoryWriteLatencyMs).toBe(5);
    expect(result.assistantMessage.metrics?.contextLatencyMs).toBe(8);
    expect(result.assistantMessage.metrics?.generationLatencyMs).toBe(10);
    expect(result.assistantMessage.metrics?.captureLatencyMs).toBe(5);
    expect(result.assistantMessage.metrics?.extractedCount).toBeGreaterThanOrEqual(1);
  });
});
