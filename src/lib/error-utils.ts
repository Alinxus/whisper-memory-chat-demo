interface GenericErrorShape {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  cause?: unknown;
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getErrorMessage(error: unknown, fallback: string) {
  if (!error) {
    return fallback;
  }

  if (error instanceof Error) {
    const text = error.message.trim();
    if (text) {
      return text;
    }
  }

  const e = error as GenericErrorShape;
  const parts: string[] = [];
  const code = toStringValue(e.code);
  const status = typeof e.status === "number" ? String(e.status) : toStringValue(e.status);
  const details = toStringValue(e.details);
  const message = toStringValue(e.message);

  if (code) {
    parts.push(code);
  }
  if (status) {
    parts.push(`status ${status}`);
  }
  if (details) {
    parts.push(details);
  }
  if (message) {
    parts.push(message);
  }

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  return fallback;
}

