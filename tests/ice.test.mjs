// Relay-only ICE hygiene (lib/ice.ts): only relay candidates cross the
// mailbox, and never with the sender's public IP in raddr.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  candidateType,
  sanitizeCandidate,
  sanitizeIcePayload,
  sanitizeSdpPayload,
  usableTurnServers,
} from "../lib/ice.ts";

const HOST = "candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0";
const SRFLX =
  "candidate:2 1 udp 1686052607 203.0.113.7 54321 typ srflx raddr 192.168.1.20 rport 54321 generation 0";
const RELAY =
  "candidate:3 1 udp 41885439 104.30.2.10 61000 typ relay raddr 203.0.113.7 rport 54321 generation 0 ufrag abcd";
const MDNS = "candidate:4 1 udp 2122260223 4f1c-uuid.local 54321 typ host";

test("candidateType reads the typ field", () => {
  assert.equal(candidateType(HOST), "host");
  assert.equal(candidateType(SRFLX), "srflx");
  assert.equal(candidateType(RELAY), "relay");
  assert.equal(candidateType("garbage"), null);
});

test("non-relay candidates are dropped, including mDNS host candidates", () => {
  for (const c of [HOST, SRFLX, MDNS, "nonsense", "candidate:", "x".repeat(2000)]) {
    assert.equal(sanitizeCandidate(c), null, c.slice(0, 40));
  }
});

test("relay candidates keep their relay address but lose the related (public) IP", () => {
  const out = sanitizeCandidate(RELAY);
  assert.ok(out);
  assert.ok(out.includes("104.30.2.10 61000 typ relay"));
  assert.ok(!out.includes("203.0.113.7"), "public IP must not survive");
  assert.ok(out.includes("raddr 0.0.0.0 rport 0"));
  assert.ok(out.endsWith("ufrag abcd"));
});

test("end-of-candidates marker passes through", () => {
  assert.equal(sanitizeCandidate(""), "");
});

test("ice payload: relay kept and scrubbed, others rejected", () => {
  const ok = sanitizeIcePayload(JSON.stringify({ candidate: RELAY, sdpMid: "0", sdpMLineIndex: 0 }));
  assert.ok(ok);
  const parsed = JSON.parse(ok);
  assert.equal(parsed.sdpMid, "0");
  assert.ok(!parsed.candidate.includes("203.0.113.7"));
  assert.equal(sanitizeIcePayload(JSON.stringify({ candidate: SRFLX, sdpMid: "0" })), null);
  assert.equal(sanitizeIcePayload("not json"), null);
  assert.equal(sanitizeIcePayload(JSON.stringify([RELAY])), null);
  assert.equal(sanitizeIcePayload(JSON.stringify({ sdpMid: "0" })), null);
});

test("sdp payload: non-relay candidate lines removed, relay scrubbed, rest untouched", () => {
  const sdp = [
    "v=0",
    "o=- 1 2 IN IP4 127.0.0.1",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    `a=${HOST}`,
    `a=${SRFLX}`,
    `a=${RELAY}`,
    "a=mid:0",
    "",
  ].join("\r\n");
  const out = sanitizeSdpPayload(JSON.stringify({ type: "offer", sdp }));
  assert.ok(out);
  const { type, sdp: clean } = JSON.parse(out);
  assert.equal(type, "offer");
  assert.ok(!clean.includes("192.168.1.20"));
  assert.ok(!clean.includes("203.0.113.7"));
  assert.ok(clean.includes("typ relay raddr 0.0.0.0 rport 0"));
  assert.ok(clean.includes("a=mid:0"));
  assert.ok(clean.includes("\r\n"), "line endings preserved");
  assert.equal(sanitizeSdpPayload(JSON.stringify({ type: "rollback", sdp })), null);
  assert.equal(sanitizeSdpPayload(JSON.stringify({ type: "offer" })), null);
});

test("usableTurnServers keeps TURN with credentials, drops STUN and port 53", () => {
  const servers = usableTurnServers([
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:53?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
        "turn:turn.cloudflare.com:53",
      ],
      username: "u",
      credential: "c",
    },
    { urls: ["turn:no-creds.example:3478"] },
  ]);
  assert.deepEqual(servers, [
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turns:turn.cloudflare.com:443?transport=tcp",
      ],
      username: "u",
      credential: "c",
    },
  ]);
  assert.deepEqual(usableTurnServers(null), []);
});
