/**
 * Conservative classifier: TRUE only for clear connectivity/transport failures
 * (DNS, TLS, socket, timeout, fetch-layer). Everything else — "no coverage",
 * validation, agent give-up — is FALSE so it terminates as `failed` and is NOT
 * auto-requeued (we never re-spam the queue for a genuine no-resource result).
 * Recurses through the `cause` chain (AI SDK / fetch wrap the real error).
 */
const TRANSIENT_PATTERNS = [
  "econnreset",
  "etimedout",
  "econnrefused",
  "enotfound",
  "eai_again",
  "epipe",
  "socket disconnected",
  "socket hang up",
  "fetch failed",
  "network socket",
  "cannot connect to api",
  "secure tls connection",
  "timeout",
  "network error",
];

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  if (typeof error === "string") {
    return error.toLowerCase();
  }
  return "";
}

export function isTransientAcquisitionError(error: unknown, depth = 0): boolean {
  if (error === null || error === undefined || depth > 5) {
    return false;
  }
  const msg = messageOf(error);
  if (TRANSIENT_PATTERNS.some((pattern) => msg.includes(pattern))) {
    return true;
  }
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? false : isTransientAcquisitionError(cause, depth + 1);
}
