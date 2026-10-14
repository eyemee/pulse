// Unit tests for the pure, security-relevant helpers: session identity,
// request body parsing and the location privacy offset.
// Run with `npm test` (Node's built-in runner; it loads the .ts sources
// directly, so no extra dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  isValidSecret,
  isValidPeerId,
  publicIdFromSecret,
  offsetSeed,
  readJson,
} from "../lib/session.ts";
import { applyPrivacyOffset, distanceKm, isValidLatLng, formatDistance } from "../lib/geo.ts";

// Same shape the browser generates: 32 random bytes, base64url.
const newSecret = () => randomBytes(32).toString("base64url");

test("secrets: browser-generated secrets are accepted, junk is rejected", () => {
  for (let i = 0; i < 50; i++) assert.equal(isValidSecret(newSecret()), true);
  for (const bad of [undefined, null, 42, "", "short", "a".repeat(31), "a".repeat(129), "has spaces in it but is long enough!!", "x".repeat(40) + "/"]) {
    assert.equal(isValidSecret(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("public id: deterministic, 64 hex chars, and never the secret itself", () => {
  const s = newSecret();
  const id = publicIdFromSecret(s);
  assert.equal(id, publicIdFromSecret(s));
  assert.equal(isValidPeerId(id), true);
  assert.notEqual(id, s);
  assert.equal(id.includes(s), false);
});

test("public id: different secrets give different ids", () => {
  const ids = new Set(Array.from({ length: 200 }, () => publicIdFromSecret(newSecret())));
  assert.equal(ids.size, 200);
});

test("peer ids: only 64 lowercase hex chars are accepted", () => {
  assert.equal(isValidPeerId("a".repeat(64)), true);
  for (const bad of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), 7, null]) {
    assert.equal(isValidPeerId(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test("offset seed: stable per session, in [0, 1)", () => {
  const s = newSecret();
  assert.deepEqual(offsetSeed(s), offsetSeed(s));
  for (let i = 0; i < 200; i++) {
    for (const v of offsetSeed(newSecret())) assert.ok(v >= 0 && v < 1);
  }
});

test("privacy offset: always 1-3 km from the real spot, including near the poles and the date line", () => {
  const spots = [
    [0, 0], [7.07, 125.61], [35.68, 139.69], [48.86, 2.35], [-33.87, 151.21],
    [64.15, -21.94], [-89.5, 0], [89.5, 45], [10, 179.999], [10, -179.999],
  ];
  for (const [lat, lng] of spots) {
    for (let i = 0; i < 300; i++) {
      const p = applyPrivacyOffset(lat, lng, offsetSeed(newSecret()));
      assert.equal(isValidLatLng(p.lat, p.lng), true);
      const d = distanceKm({ lat, lng }, p);
      // 1% tolerance for the flat-earth approximation used by the offset.
      assert.ok(d >= 0.99 && d <= 3.03, `offset ${d.toFixed(3)} km at ${lat},${lng}`);
    }
  }
});

test("privacy offset: same session seed gives the same position (no averaging across re-joins)", () => {
  const seed = offsetSeed(newSecret());
  assert.deepEqual(applyPrivacyOffset(14.6, 121, seed), applyPrivacyOffset(14.6, 121, seed));
});

test("coordinates: out-of-range and non-numeric values are rejected", () => {
  assert.equal(isValidLatLng(90, 180), true);
  for (const [a, b] of [[91, 0], [0, 181], [NaN, 0], [0, Infinity], ["1", 2], [null, 0]]) {
    assert.equal(isValidLatLng(a, b), false);
  }
});

test("distance label never shows more precision than the offset allows", () => {
  assert.equal(formatDistance(4), "Nearby");
  assert.equal(formatDistance(9.9), "Nearby");
  assert.match(formatDistance(11200), /^About 11,200 km away$/);
});

const req = (body) => new Request("http://x/api", { method: "POST", body });

test("readJson: accepts JSON objects (also as text/plain, for sendBeacon)", async () => {
  assert.deepEqual(await readJson(req('{"secret":"abc"}')), { secret: "abc" });
  const beacon = new Request("http://x/api", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: '{"secret":"abc"}',
  });
  assert.deepEqual(await readJson(beacon), { secret: "abc" });
});

test("readJson: rejects malformed, non-object and oversized bodies", async () => {
  for (const body of ["", "not json", "[1,2]", "null", '"str"', "42"]) {
    assert.equal(await readJson(req(body)), null, `should reject ${body}`);
  }
  const big = JSON.stringify({ pad: "x".repeat(49 * 1024) });
  assert.equal(await readJson(req(big)), null);
});
