// A repeating timer that keeps firing when the tab is hidden.
//
// Chrome throttles timers on the main thread of hidden pages, and after a
// few minutes hidden it only lets chained timers run about once a minute.
// For Pulse that meant a backgrounded tab stopped heartbeating, got reaped
// from presence after STALE_MS, and missed incoming requests. Timers inside a
// dedicated worker aren't subject to that intensive throttling, so the worker
// only keeps time and posts a message; the actual work stays on the main
// thread (message delivery isn't a throttled timer).

const WORKER_SOURCE = `
let t;
onmessage = (e) => {
  clearInterval(t);
  if (e.data > 0) t = setInterval(() => postMessage(0), e.data);
};
`;

export function startTicker(intervalMs: number, onTick: () => void): () => void {
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
    try {
      const url = URL.createObjectURL(
        new Blob([WORKER_SOURCE], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = () => onTick();
      worker.postMessage(intervalMs);
      return () => worker.terminate();
    } catch {
      // Fall through to a plain interval (e.g. a CSP that blocks blob workers).
    }
  }
  const id = setInterval(onTick, intervalMs);
  return () => clearInterval(id);
}
