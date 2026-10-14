-- Track the pending/active connection partner so /api/signal can enforce
-- the request -> accept -> offer/answer/ice -> end flow server-side.
ALTER TABLE "Presence" ADD COLUMN "peerId" TEXT;
