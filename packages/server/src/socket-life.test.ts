import { describe, expect, it } from "vitest";
import { attachSocketHeartbeat } from "./socket-life.js";

function fakeSocket() {
  const listeners: Record<string, Array<() => void>> = {};
  let terminated = false;
  const socket = {
    readyState: 1,
    on(event: "pong" | "message" | "close", listener: () => void) {
      (listeners[event] ??= []).push(listener);
    },
    ping() {},
    terminate() {
      terminated = true;
      socket.readyState = 3;
    },
  };
  return {
    socket,
    listeners,
    get terminated() {
      return terminated;
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("socket heartbeat", () => {
  it("closes a socket that stops answering", async () => {
    const fake = fakeSocket();
    attachSocketHeartbeat(fake.socket, 30);
    await sleep(100);
    expect(fake.terminated).toBe(true);
  });

  it("keeps a 4-player seat that is still sending moves when the pong never arrives", async () => {
    const fake = fakeSocket();
    attachSocketHeartbeat(fake.socket, 30);
    const started = Date.now();
    while (Date.now() - started < 140) {
      for (const mark of fake.listeners.message ?? []) mark();
      await sleep(20);
    }
    expect(fake.terminated).toBe(false);
  });
});
