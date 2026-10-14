// Server-side session identity.
//
// Each browser generates a random private secret and sends it in request
// bodies only. The public id that other people see on the map (and address
// signals to) is derived from it: sha256(secret). Knowing someone's public id
// therefore lets you send them a request, but not poll their mailbox, send
// signals as them, or remove them from the map.
import { createHash } from "node:crypto";

const SECRET_RE = /^[A-Za-z0-9_-]{32,128}$/;
const PEER_ID_RE = /^[0-9a-f]{64}$/;

function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

export function isValidSecret(v: unknown): v is string {
  return typeof v === "string" && SECRET_RE.test(v);
}

export function isValidPeerId(v: unknown): v is string {
  return typeof v === "string" && PEER_ID_RE.test(v);
}

export function publicIdFromSecret(secret: string): string {
  return sha256(`pulse:id:${secret}`).toString("hex");
}

// Two numbers in [0, 1), stable for the life of a session. Used for the
// privacy offset so that re-joining (after being reaped) lands on the same
// spot. A fresh random offset on every re-join would let an observer collect
// many samples around the real location and average them out.
export function offsetSeed(secret: string): [number, number] {
  const h = sha256(`pulse:offset:${secret}`);
  return [h.readUInt32BE(0) / 2 ** 32, h.readUInt32BE(4) / 2 ** 32];
}

// Read { secret } from a JSON body (also accepts a text/plain body, which is
// what navigator.sendBeacon sends). Returns null if missing or malformed.
export async function readJson(
  request: Request,
  maxBytes = 48 * 1024,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text || text.length > maxBytes) return null;
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
