import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/error-utils";
import { getMemoryRuntime } from "@/lib/server/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchBodySchema = z.object({
  content: z.string().min(1).max(2_000),
});

type RouteContext = {
  params: Promise<{ memoryId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { memoryId } = await context.params;
    const payload = patchBodySchema.parse(await request.json());
    await getMemoryRuntime().updateMemory(memoryId, payload.content);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update memory.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { memoryId } = await context.params;
    await getMemoryRuntime().deleteMemory(memoryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete memory.");
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
