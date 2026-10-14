import type { NextConfig } from "next";

// Baseline security headers. Kept deliberately narrow: a full CSP would need
// careful allowances for Mapbox (workers, blob URLs, tiles, telemetry) and is
// listed as follow-up work in NOTES.md.
const securityHeaders = [
  // Nobody may frame Pulse. Otherwise a hostile page could overlay it and
  // trick someone into clicking "Accept" on a video call (clickjacking).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // Only Pulse itself (no embedded third party) may ask for these.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // The floating "N" dev badge sat on top of the map UI (it covered the
  // online counter). Dev-only; no effect in production.
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
