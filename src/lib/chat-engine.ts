import {
  appendConversationMessage,
  getConversationHistory,
} from "@/lib/chat-history";
import type { ChatMessage, TurnMetrics, UsedMemory } from "@/lib/types";

export interface ContextResponse {
  context: string;
  usedMemories: UsedMemory[];
  contextCount: number;
  latencyMs: number;
}

export interface MemoryClient {
  getContext(args: {
    userId: string;
    sessionId: string;
    query: string;
  }): Promise<ContextResponse>;
  captureSession(args: {
    userId: string;
    sessionId: string;
    messages: Array<{ role: string; content: string }>;
  }): Promise<{ extracted: number; latencyMs: number }>;
}

export interface LlmClient {
  generate(input: {
    userMessage: string;
    context: string;
    history: ChatMessage[];
  }): Promise<{ text: string; latencyMs: number; provider: string }>;
}

export interface ChatEngineResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  provider: string;
}

export class ChatEngine {
  constructor(
    private readonly memoryClient: MemoryClient,
    private readonly llmClient: LlmClient,
  ) {}

  async runTurn(args: {
    userId: string;
    sessionId: string;
    userMessage: string;
  }): Promise<ChatEngineResult> {
    const turnStartedAt = Date.now();
    const history = getConversationHistory(args.userId, args.sessionId);

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: args.userMessage,
      createdAt: new Date().toISOString(),
    };

    appendConversationMessage(args.userId, args.sessionId, userMessage);

    const contextResult = await this.memoryClient.getContext({
      userId: args.userId,
      sessionId: args.sessionId,
      query: args.userMessage,
    });

    const llmResult = await this.llmClient.generate({
      userMessage: args.userMessage,
      context: contextResult.context,
      history,
    });

    const captureResult = await this.memoryClient
      .captureSession({
        userId: args.userId,
        sessionId: args.sessionId,
        messages: [
          { role: "user", content: args.userMessage },
          { role: "assistant", content: llmResult.text },
        ],
      })
      .catch(() => ({
        extracted: 0,
        latencyMs: 0,
      }));

    const metrics: TurnMetrics = {
      totalLatencyMs: Date.now() - turnStartedAt,
      whisperLatencyMs: contextResult.latencyMs + captureResult.latencyMs,
      memorySearchLatencyMs: contextResult.latencyMs,
      memoryWriteLatencyMs: captureResult.latencyMs,
      contextLatencyMs: contextResult.latencyMs,
      generationLatencyMs: llmResult.latencyMs,
      captureLatencyMs: captureResult.latencyMs,
      extractedCount: captureResult.extracted,
      contextCount: contextResult.contextCount,
    };

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: llmResult.text,
      createdAt: new Date().toISOString(),
      usedMemories: contextResult.usedMemories,
      metrics,
    };

    appendConversationMessage(args.userId, args.sessionId, assistantMessage);

    return {
      userMessage,
      assistantMessage,
      provider: llmResult.provider,
    };
  }
}
