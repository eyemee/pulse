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

Assumptions and trade-offs:
- Re-join reuses the raw location held in memory for the session. It's never stored server-side, which matches the requirement.
- The presence-based backstop takes about 15 to 20s (the stale window). I kept `STALE_MS` at 15s and didn't add a faster beacon retry, since the data channel close already covers the normal case.
- Two people tapping each other at the same moment can still race. It's rare, and the second request just gets declined, so I left it.

## Phase 2: Make it good

## Phase 3: Make it secure

## Phase 4: Make it better
