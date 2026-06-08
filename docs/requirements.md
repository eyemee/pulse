# Pulse — Business Requirements

> A living globe of anonymous strangers. Every online user is a dot. Tap one, start talking.

---

## Overview

Pulse is a real-time anonymous connection app. Users appear on a world map as dots near their location and can connect with strangers for text chat or video calls. There are no accounts, no history, and no traces. When a session ends, everything disappears.

---

## Users

- Anyone can use the app with no sign-up or login
- On first visit, the app requests location access from the browser
- Each session is temporary — closing the tab ends it completely

---

## The Map

- The app opens to a full-screen world map
- Every online user appears as a visible dot on the map
- Dots are live — they appear when users join and disappear when they leave
- A user's dot is placed near their real location but not at their exact coordinates — there must be a randomisation offset of 1–3 km to protect privacy
- The same user gets a different dot position each session
- Users can zoom and pan the map freely to explore any region in the world

---

## Connecting with Someone

- Tapping or clicking another user's dot sends them a connection request
- The target user sees a notification and can accept or decline
- A user can only be in one active connection at a time
- If a request is declined or ignored, the initiator is notified
- There is no way to message someone before they accept a connection

---

## Text Chat

- Once a connection is accepted, a chat panel opens for both users
- Both users can send and receive text messages in real time
- Messages are never stored — they exist only during the active session
- If either user disconnects, the chat ends for both

---

## Video Call

- From within an active chat, either user can initiate a video call
- The other user must accept before the video starts
- Both users' cameras and microphones are used
- Either user can end the video call at any time and return to text chat
- Video is never recorded or stored

---

## Session and Privacy

- There are no user accounts or profiles
- No personally identifiable information is collected or stored
- Location is only used to place the dot on the map — it is never stored beyond the active session
- Chat messages and video are never seen or stored by the server
- Closing the browser tab immediately ends the session and removes the user's dot from the map

---

## Stateless by Design

- Nothing persists between sessions
- There is no message history, no call history, no connection history
- Every session starts completely fresh
- The server holds no data about a user once their session ends

---

## Deployment

- The app must be deployable to Vercel with no external services or third-party platforms required
- The entire app runs as a single Next.js project