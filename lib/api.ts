// Client-side helpers for talking to the coordination API.
//
// `secret` is this tab's private session key. It only ever travels in POST
// bodies; the public id other people see is derived from it on the server.
import type { PollResponse, SignalType } from "@/lib/types";

// 32 random bytes, base64url. getRandomValues (unlike randomUUID) also works
// outside secure contexts, though the app needs one for location anyway.
export function newSessionSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function post(path: string, body: unknown, init?: RequestInit) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    ...init,
  });
}

// Returns this session's public id.
export async function join(secret: string, lat: number, lng: number): Promise<string> {
  const res = await post("/api/join", { secret, lat, lng });
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function poll(secret: string): Promise<PollResponse> {
  const res = await post("/api/poll", { secret });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  secret: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<boolean> {
  // false when the server rejected it (e.g. the request was already
  // cancelled) or the network failed.
  try {
    const res = await post("/api/signal", { secret, toId, type, payload });
    return res.ok;
  } catch {
    return false;
  }
}

// Fire-and-forget leave that survives the tab closing.
export function leave(secret: string): void {
  const body = JSON.stringify({ secret });
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/leave", body);
  } else {
    void fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    });
  }
}
