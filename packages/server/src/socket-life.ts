/**
 * Keep a live socket only while the other end is still there.
 * A move counts. A pong counts. A socket that does neither is closed.
 * Game traffic must not be treated as a dead connection when a proxy drops the pong.
 */
export function attachSocketHeartbeat(
  socket: {
    readyState: number;
    on(event: "pong" | "message" | "close", listener: () => void): void;
    ping(): void;
    terminate(): void;
  },
  intervalMs = 20_000,
): void {
  let sawLife = true;
  const mark = () => {
    sawLife = true;
  };
  socket.on("pong", mark);
  socket.on("message", mark);
  const beat = setInterval(() => {
    if (socket.readyState !== 1) return;
    if (!sawLife) {
      console.warn("[ws] closing a socket that stopped answering.");
      socket.terminate();
      return;
    }
    sawLife = false;
    try {
      socket.ping();
    } catch {
      // The socket is already closing.
    }
  }, intervalMs);
  beat.unref?.();
  socket.on("close", () => clearInterval(beat));
}
