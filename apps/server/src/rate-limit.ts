import type { Context } from "hono";
import { getEnvNum } from "@cortex/shared";

/**
 * Per-IP limit on sending sign-in codes.
 *
 * `requestOtp` already limits **per email address**, which stops one person being hammered.
 * What it did not stop is a single IP requesting codes for many different addresses: each one
 * starts with a fresh allowance. With email sending switched on, those are real messages to
 * real people, and a bill.
 *
 * It is a measure scoped to this endpoint, not a general server limit: that lives at the edge
 * (a proxy or a CDN), where it can be stopped before a process is spent. Here we cover the one
 * place that, unauthenticated, causes an effect outside the server.
 *
 * A fixed, in-memory window on purpose: the cost of a shared store is not justified for a
 * single endpoint, and one node is enough. If there are ever several nodes, each will apply
 * its share of the limit; it is noted in the roadmap alongside the MCP sessions.
 */

const MAX = (): number => getEnvNum("CORTEX_AUTH_IP_MAX", 10);
const WINDOW_MS = (): number => getEnvNum("CORTEX_AUTH_IP_WINDOW_MIN", 15) * 60_000;

interface Window {
  until: number;
  count: number;
}
const windows = new Map<string, Window>();

/**
 * The client's IP. Behind our own proxy, `x-forwarded-for` ends with the real IP and **the
 * last** one is taken, not the first: the first is written by the caller and can be made up,
 * so using it would turn the limit into decoration.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return c.req.header("x-real-ip") ?? "unknown";
}

/** `true` when this IP has gone over. It counts the request. */
export function tooManyRequests(ip: string, now = Date.now()): boolean {
  const w = windows.get(ip);
  if (!w || now >= w.until) {
    windows.set(ip, { until: now + WINDOW_MS(), count: 1 });
    sweep(now);
    return false;
  }
  w.count++;
  return w.count > MAX();
}

/** Without this the map grows with every IP that passes through and is never emptied. */
function sweep(now: number): void {
  if (windows.size < 1000) return;
  for (const [ip, w] of windows) if (now >= w.until) windows.delete(ip);
}

/** Tests only: resets the counter. */
export function resetRateLimit(): void {
  windows.clear();
}
