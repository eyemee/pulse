# Notes

## Phase 1: Make it run

I read through the API routes, the WebRTC wrapper and the page state machine first, then reproduced each problem before fixing it. Server bugs I reproduced with curl against a local Postgres. For the browser side I used a small Playwright script that opens two (later three) Chromium sessions with fake camera/mic and different geolocations, then joins, connects, chats, starts video, hangs up, reconnects and closes tabs. On the original code it got as far as "see each other" and stalled on connect. After the fixes every step passes. (The script isn't committed; it needed a temporary hook to "tap a dot", since the map needs a real Mapbox token.)

Per `AGENTS.md`, I checked the route handlers against the Next 16 docs bundled in `node_modules/next/dist/docs`. None of the bugs turned out to be framework changes.

What was broken, roughly in the order you'd hit it:

1. **Dots never left the map.** The poll heartbeat did `updateMany({ where: {} })`, which refreshed `lastSeen` on every row whenever anyone polled. Nobody ever went stale. Scoped it to the caller's id.
2. **Stuck on "Connecting…".** ICE candidates that arrived before the offer/answer were queued, but the queue was flushed *before* `setRemoteDescription`. `addIceCandidate` rejects without a remote description and the error was swallowed, so the early candidates were lost and the data channel never opened. Moved the flush after `setRemoteDescription`. I also process incoming signals through a promise queue, because the offer and its candidates are separate HTTP requests and can land in either order.
3. **Chat messages never arrived.** The sender tagged messages `t: "msg"`, the receiver only accepts `t: "chat"`. One-word fix.
4. **You could only ever connect once.** `busy` was set on accept and cleared on decline, but never on `end`. After any chat ended, both people stayed busy for the rest of their session and every new request was auto-declined. `end` now frees both.
5. **Closing the tab mid-chat left the other person stranded.** Nothing told them. The chat stayed open on a dead connection, and they stayed busy too. Now the chat ends when the data channel closes (about 1s), or when the peer drops out of presence for two polls in a row (backstop if the unload beacon never made it). These teardowns send `end` so the server frees our busy flag.
6. **Invisible after a sleep or long background.** If the presence row got reaped (laptop asleep, tab throttled), the heartbeat had nothing to update and the user stayed invisible to everyone while still seeing others. The poll now says whether the caller's row exists, and the client re-joins with a fresh offset.
7. **Blank map with no explanation.** A missing `NEXT_PUBLIC_MAPBOX_TOKEN` fell back to a hard-coded fake token, so the map silently failed with a 401 and the "set your token" hint never showed.
8. **Background tabs dropped off the map.** Found when testing by hand with two overlapping windows: the hidden one never got the request. Chrome throttles timers on hidden pages, down to about once a minute after a few minutes, so a background tab stopped heartbeating, got reaped after 15s and missed requests. The poll loop is now driven by a tiny Web Worker timer (not subject to that throttling); the fetch still runs on the main thread. It also polls immediately on returning to the tab, and the tab title flashes when a request comes in while hidden.

Assumptions and trade-offs:
- Re-join reuses the raw location held in memory for the session. It's never stored server-side, which matches the requirement.
- The presence-based backstop takes about 15 to 20s (the stale window). I kept `STALE_MS` at 15s and didn't add a faster beacon retry, since the data channel close already covers the normal case.
- Two people tapping each other at the same moment can still race. It's rare, and the second request just gets declined, so I left it.

## Phase 2: Make it good

The idea: Pulse should feel like looking at Earth from orbit at night, where every light is a person. Real cities glow sodium-amber in night satellite photos, so that's the colour of a stranger, and it's the only saturated colour in the app. You're a cooler aurora-teal light so you can always find yourself. Everything else is navy glass that gets out of the way.

What changed:
- **The globe is the hero.** Mapbox globe projection with a navy atmosphere and faint stars. It's live behind the entry screen, slowly turning, and flies down to your light when you join, so the first thing you see is the world rather than a form.
- **Lights that feel alive.** Each one breathes on its own rhythm (staggered, so the map shimmers instead of blinking in sync). Busy people dim and stop breathing but stay visible.
- **You're drawn where others see you.** Your beacon sits at your offset position (join now returns it), not your real location, which makes the privacy promise visible and honest.
- **The arc.** When you ask someone to talk, a great-circle line draws itself from you to them: dashed while waiting, solid once connected. It's the one bold moment, and it makes "a stranger 950 km away" tangible.
- **The flow, tightened.** Requests come up from the bottom (thumb reach on phones) with a rough distance, a draining 30s bar, Accept focused, and Escape to decline. Calling is a small card with Cancel. Chat is a floating panel on desktop and a bottom sheet on phones, so the globe and arc stay in view. Video got mute and camera-off buttons and a mirrored self-view.
- **Empty and error states that say what to do.** "You're the only light on right now" with Copy link. Location errors explain how to fix them.
- **Copy rewritten** in plain, specific language ("Put me on the map", "Someone wants to talk", "About 950 km away").
- **Details:** one typeface (Manrope), design tokens in `globals.css`, safe-area padding for notched phones, visible keyboard focus, `prefers-reduced-motion` respected (no spin, no breathing, instant fly-to), and screen-reader labels on every light.

Trade-offs:
- Distances are deliberately coarse ("Nearby", "About 950 km away"). Positions are already offset by 1–3 km, so more precision would be false and would leak more.
- I kept everything on Tailwind plus a handful of CSS keyframes rather than adding an animation library.
- Lights are DOM markers, which is fine for hundreds of people. At thousands I'd move them to a Mapbox circle layer with clustering.

## Phase 3: Make it secure

I went through the four routes with curl and tried to break them as a second, hostile user. Ranked by impact:

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | Session ids were public and were the only credential | Critical | Fixed |
| 2 | Server relayed any signal to anyone (no connection state) | High | Fixed |
| 3 | No rate limiting anywhere | High | Fixed |
| 4 | WebRTC reveals each person's public IP to the stranger | High (privacy) | Not fixable within the rules, see below |
| 5 | Dot positions could be averaged back to the real location | Medium (privacy) | Fixed within a session |
| 6 | Pulse could be framed by another site (clickjacking) | Medium | Fixed |
| 7 | Loose input validation, unbounded bodies and chat messages | Low | Fixed |
| 8 | Public Mapbox token usable from any site | Low | Config, at deploy |

1. **Impersonation.** Every poll returns everyone's id, and that id was all you needed to act as someone. I confirmed you could poll as another user and drain their mailbox (stealing their requests, SDP and ICE candidates with IP addresses), send signals as them, and remove them from the map via `/api/leave`. Now each tab makes a random 32-byte secret that only travels in POST bodies, and the public id is `sha256(secret)`. Knowing someone's id lets you send them a request and nothing else. `/api/poll` moved from GET to POST so the secret never ends up in a URL or a log, and returns nothing until you've joined, so you can't scrape positions without being on the map yourself.
2. **No server-side state.** Even with real identities, a forged `accept` marked any stranger busy, which greys out their dot and auto-declines every real request to them. Offers could be pushed at people who never agreed to connect. Presence now records `peerId`, and `/api/signal` enforces the flow: accept only works if that person actually requested you and is still waiting, SDP/ICE only flows between the two partners, and end/decline only touch rows that point at each other.
3. **Rate limits.** These are counted in Postgres, because in-memory counters don't hold on Vercel, where every instance has its own memory. Join is 30/min per IP. Poll is 120/min per session (the client needs about 40). Signals are 300/min per session. Requests are 10/min, and 3 per 2 minutes to the same person, since a request is what lands on a stranger's screen. To offset the extra query, poll housekeeping now runs on about 1 in 4 polls instead of every one.
4. **IP exposure (not fixed).** Once two people connect, WebRTC ICE candidates include each side's public IP, and IP geolocation can be city-level or better, which undercuts the 1–3 km offset. The real fix is relaying media through TURN (`iceTransportPolicy: "relay"`), which needs an external TURN service, and the requirements rule those out. ICE is already only exchanged after both people accept. I'd put this first on the list for a real launch.
5. **Averaging.** A fresh random offset on every re-join would let an observer collect samples and average them back to the real spot. The offset is now derived from the session secret, so a session always lands in the same place. Across many separate sessions the same person's dots could still be averaged. Snapping to a grid first would help, but it breaks the "1–3 km" rule as written, so I left it as a note.
6. **Headers.** `frame-ancestors 'none'` plus `X-Frame-Options`, so nobody can overlay Pulse and trick a click on "Accept". A `Permissions-Policy` limiting camera, mic and location to Pulse itself. Also nosniff, no-referrer and HSTS. I didn't add a full CSP: Mapbox needs workers, blob URLs and several hosts, and getting that wrong breaks the map.
7. **Validation.** Strict id and secret formats, a JSON payload required only for SDP/ICE, request body size caps, and chat capped at 2000 characters on both sides (it's peer-to-peer, so the server can't police it). I also removed a leftover ngrok host from the dev config.
8. **Mapbox token.** Public tokens are visible in the page by design. The fix is a URL restriction in the Mapbox dashboard (Vercel domain + localhost), done at deploy time.

**Dependencies.** `npm audit` flagged the starter's Next.js 16.2.7, including a critical advisory in the image optimizer, which is on by default. I upgraded to 16.4.1 (same major) and applied the non-breaking transitive fixes. What's left is inside the Prisma CLI (mysql2, deepmerge-ts, hono, valibot), which only runs at build time and isn't imported by the app. npm's suggested fix is a downgrade to Prisma 6, which would break the project, so I left it. I also turned off the `X-Powered-By` header.

Checked and fine: SQL injection (Prisma parameterises, and the raw queries use tagged templates, which are parameterised too), XSS (React escapes chat text), CSRF (no cookies; the secret is in the body).

Next, with more time: TURN relay-only, a full CSP, and block/report so people can protect themselves (which is where Phase 4 comes in).

## Phase 4: Make it better

The brief asked for "alive and/or safe". I did both, because on a site that connects strangers the two pull on each other: the more you can see happening, the more you need a way out of a bad connection.

**What I built**

1. **Live arcs: see conversations happen.** When two people connect, an arc of light draws between their dots for everyone on the globe, and both dots spark. Your own call gets a dashed arc while it's ringing and a solid one once you're connected. Before this, the map looked the same whether people were talking or not. Now you can watch the world talk, which is the best argument for joining in. The server sends pairs as two public ids. It never sends `peerId` itself, and pairs only appear once both sides agree (`busy` on both and pointing at each other), so a pending or forged request never draws an arc.
2. **Blur until you reveal.** When video starts, the other person's picture is heavily blurred until you tap "Reveal video". They see a chip saying whether you've revealed them yet. Video with a stranger is the riskiest moment in the app, and this means nothing lands on your screen before you decide to look. It costs one tap for people who were going to look anyway.
3. **Block.** From the chat, the video call, or straight from an incoming request ("Decline and block"). Blocking ends the call, hides each of you from the other's map, and the server refuses any further requests between you (checked in `/api/signal`, not just hidden in the UI). Blocks are stored in a `Block` table and deleted when either person leaves, because there are no accounts to keep them against.
4. **Finding people.** Testing showed the globe was hard to navigate. You now get place search (Mapbox geocoding), a "Next light" button that flies to the nearest available person, and a tap on the online count fits everyone in view.
5. **Testing from one machine.** Visiting `/?at=Tokyo` (or `/?at=35.68,139.69`) joins near that place without asking for location, so one person can play several users in different windows. The entry screen says when this is on.

**Trade-offs**

- Arcs show *who* is talking to *whom* among anonymous lights. The dots are already offset by 1–3 km and carry no identity, so I judged that fine, but it's a real reveal and the first thing I'd ask a privacy reviewer about.
- `?at=` lets anyone choose where they appear. That was already true through DevTools Sensors, so it doesn't open anything new; it just makes testing easier. In production I'd put it behind a flag.
- Blocks only last a session, since a new tab gets a new identity. Without accounts, that's the honest limit. A determined person can come back, but they can't keep pestering the same session.
- Blur happens on the receiving side, so it protects the viewer, not the sender. Someone could in theory read the raw stream with their own code. Protecting the sender would mean not sending until revealed, which adds a renegotiation round trip; I chose the instant version.

**Next, with more time:** report-to-moderator alongside block (needs somewhere for reports to go), a short arc trail when a conversation ends so the globe shows recent activity, and opt-in interest tags shown on hover so connections aren't fully random.

