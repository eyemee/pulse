// ICE candidate hygiene, shared by the browser and the signal route.
//
// Pulse sends all media through a TURN relay (iceTransportPolicy "relay"), so
// the only candidates that should ever cross the mailbox are relay candidates.
// Host and server-reflexive candidates carry the sender's LAN or public IP,
// and the public IP geolocates far better than the 1–3 km map offset hides.
//
// A relay candidate still has a "raddr"/"rport" (related address), which for
// relay candidates is the sender's public mapped address. The receiving
// browser never needs it (it's informational), so it's zeroed on both sides.
//
// Candidate grammar (RFC 8839):
//   candidate:<foundation> <component> <transport> <priority> <address> <port>
//     typ <type> [raddr <addr> rport <port>] [extension pairs...]

const MAX_CANDIDATE_LENGTH = 1024;

export function candidateType(candidate: string): string | null {
  const parts = candidate.trim().split(/\s+/);
  const i = parts.indexOf("typ");
  return i >= 0 && i + 1 < parts.length ? parts[i + 1].toLowerCase() : null;
}

// Returns the candidate with raddr/rport zeroed, or null if it isn't a relay
// candidate (or is malformed). An empty string is the end-of-candidates marker
// and is passed through unchanged.
export function sanitizeCandidate(candidate: string): string | null {
  if (candidate === "") return "";
  if (candidate.length > MAX_CANDIDATE_LENGTH) return null;
  const prefix = candidate.startsWith("a=") ? "a=" : "";
  const body = prefix ? candidate.slice(2) : candidate;
  if (!body.startsWith("candidate:")) return null;
  if (candidateType(body) !== "relay") return null;

  const parts = body.trim().split(/\s+/);
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "raddr") parts[i + 1] = "0.0.0.0";
    else if (parts[i] === "rport") parts[i + 1] = "0";
  }
  return prefix + parts.join(" ");
}

// For an "ice" signal payload: JSON of an RTCIceCandidateInit. Returns the
// re-serialised, sanitised payload, or null if it must be dropped.
export function sanitizeIcePayload(payload: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const init = data as Record<string, unknown>;
  if (typeof init.candidate !== "string") return null;
  const candidate = sanitizeCandidate(init.candidate);
  if (candidate === null) return null;
  return JSON.stringify({ ...init, candidate });
}

// For an "offer"/"answer" payload: JSON of an RTCSessionDescriptionInit.
// Drops every non-relay a=candidate line and zeroes raddr on the rest. With
// trickle ICE the SDP normally has no candidates at all; this catches
// non-trickle or out-of-date clients.
export function sanitizeSdpPayload(payload: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const desc = data as Record<string, unknown>;
  if (typeof desc.sdp !== "string") return null;
  if (desc.type !== "offer" && desc.type !== "answer") return null;

  const eol = desc.sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines: string[] = [];
  for (const line of desc.sdp.split(/\r?\n/)) {
    if (line.startsWith("a=candidate:")) {
      const clean = sanitizeCandidate(line);
      if (clean) lines.push(clean);
    } else {
      lines.push(line);
    }
  }
  return JSON.stringify({ ...desc, sdp: lines.join(eol) });
}

// Cloudflare includes a port-53 TURN URL that browsers block; it only adds a
// timeout. Keep STUN out too: with relay-only it's never used.
export function usableTurnServers(servers: unknown): RTCIceServer[] {
  if (!Array.isArray(servers)) return [];
  const out: RTCIceServer[] = [];
  for (const s of servers) {
    if (!s || typeof s !== "object") continue;
    const { urls, username, credential } = s as Record<string, unknown>;
    const list = (Array.isArray(urls) ? urls : [urls]).filter(
      (u): u is string => typeof u === "string" && /^turns?:/.test(u) && !/:53(\?|$)/.test(u),
    );
    if (list.length === 0 || typeof username !== "string" || typeof credential !== "string") {
      continue;
    }
    out.push({ urls: list, username, credential });
  }
  return out;
}
