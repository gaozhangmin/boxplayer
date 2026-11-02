import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * §7 P1 session cookie signing. The httpOnly cookie carries `<sessionId>.<hmac>`;
 * the HMAC (keyed by the instance secret) lets the server trust the session id
 * without a DB lookup to detect tampering. The id still indexes a `sessions` row
 * (for expiry/revocation) — the signature only guards integrity in transit.
 */

/** Random opaque session id stored in the `sessions` table. */
export function generateSessionId(): string {
  return `sess_${randomBytes(24).toString("hex")}`;
}

export function signSession(sessionId: string, secret: string): string {
  return `${sessionId}.${hmac(sessionId, secret)}`;
}

/** Returns the session id if the signature is valid, else null (tamper/format). */
export function verifySession(cookieValue: string, secret: string): string | null {
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) {
    return null;
  }
  const sessionId = cookieValue.slice(0, dot);
  const signature = cookieValue.slice(dot + 1);
  const expected = hmac(sessionId, secret);
  // Constant-time compare; lengths must match for timingSafeEqual.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  return sessionId;
}

export function isSessionExpired(expiresAt: string, now: string): boolean {
  return expiresAt <= now;
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
