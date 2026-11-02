import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

/**
 * §7 P1 password hashing. Built on Node's built-in `scrypt` — a memory-hard KDF
 * appropriate for this self-host threat model (login exists to SEPARATE each
 * account's data, not to defend a public endpoint; see the multi-account design).
 * Built-in means zero native dependency and no Docker/registry build step. The
 * algorithm is isolated here, so swapping in argon2 later is a one-file change.
 *
 * Stored format: `scrypt:<saltHex>:<keyHex>` (salt 16 bytes, key 64 bytes).
 */
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[1]!, "hex");
    expected = Buffer.from(parts[2]!, "hex");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = (await scrypt(plain, salt, KEY_LENGTH)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
