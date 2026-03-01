import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/error-utils";
import { getChatEngine } from "@/lib/server/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatPayloadSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  message: z.string().min(1).max(2_000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = chatPayloadSchema.parse(body);

    const result = await getChatEngine().runTurn({
      userId: payload.userId,
      sessionId: payload.sessionId,
      userMessage: payload.message,
    });

    return NextResponse.json({
      ok: true,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
      provider: result.provider,
    });
  } catch (error) {
    const message = getErrorMessage(error, "Chat request failed.");
    const status = message.includes("required") || message.includes("Invalid")
      ? 400
      : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );
  }
}
