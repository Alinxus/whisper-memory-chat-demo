import { ChatEngine } from "@/lib/chat-engine";
import { generateAssistantReply } from "@/lib/llm-service";
import { WhisperMemoryService } from "@/lib/memory-service";

let chatEngine: ChatEngine | null = null;
let memoryService: WhisperMemoryService | null = null;

function getMemoryService() {
  if (!memoryService) {
    memoryService = new WhisperMemoryService();
  }
  return memoryService;
}

export function getChatEngine() {
  if (!chatEngine) {
    chatEngine = new ChatEngine(getMemoryService(), {
      generate: generateAssistantReply,
    });
  }
  return chatEngine;
}

export function getMemoryRuntime() {
  return getMemoryService();
}

