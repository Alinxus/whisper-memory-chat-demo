import type { ChatMessage } from "@/lib/types";
import type { ContextResponse, LlmClient, MemoryClient } from "@/lib/chat-engine";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function keywordSummary(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .slice(0, 120);
}

export class FakeMemoryClient implements MemoryClient {
  private readonly userMemories = new Map<string, string[]>();

  constructor(
    private readonly delays: {
      contextMs?: number;
      captureMs?: number;
    } = {},
  ) {}

  seed(userId: string, values: string[]) {
    this.userMemories.set(userId, values);
  }

  async getContext(args: { userId: string; sessionId: string; query: string }): Promise<ContextResponse> {
    if (this.delays.contextMs) {
      await sleep(this.delays.contextMs);
    }

    const memories = this.userMemories.get(args.userId) ?? [];
    const used = memories
      .filter((memory) => memory.includes(keywordSummary(args.query).split(" ")[0] || ""))
      .slice(0, 3);

    const usedMemories = (used.length ? used : memories.slice(0, 2)).map((memory, index) => ({
      id: `${args.userId}-${index}`,
      content: memory,
      score: 0.9 - index * 0.1,
      type: "preference",
    }));

    return {
      context: usedMemories.map((item) => item.content).join("\n"),
      usedMemories,
      contextCount: usedMemories.length,
      latencyMs: this.delays.contextMs ?? 0,
    };
  }

  async captureSession(args: {
    userId: string;
    sessionId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ extracted: number; latencyMs: number }> {
    if (this.delays.captureMs) {
      await sleep(this.delays.captureMs);
    }

    const userMessage = args.messages.find((message) => message.role === "user")?.content ?? "";
    const candidate = keywordSummary(userMessage);
    if (candidate.length > 6) {
      const current = this.userMemories.get(args.userId) ?? [];
      this.userMemories.set(args.userId, [...current, candidate].slice(-15));
      return { extracted: 1, latencyMs: this.delays.captureMs ?? 0 };
    }

    return { extracted: 0, latencyMs: this.delays.captureMs ?? 0 };
  }
}

export class FakeLlmClient implements LlmClient {
  constructor(private readonly latencyMs = 12) {}

  async generate(input: {
    userMessage: string;
    context: string;
    history: ChatMessage[];
  }): Promise<{ text: string; latencyMs: number; provider: string }> {
    await sleep(this.latencyMs);
    const memoryText = input.context ? `Memory: ${input.context}` : "Memory: none";
    return {
      text: `${memoryText}\nReply: ${input.userMessage}`,
      latencyMs: this.latencyMs,
      provider: "fake-llm",
    };
  }
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}
