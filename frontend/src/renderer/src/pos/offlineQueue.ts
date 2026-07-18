/**
 * Offline sale queue.
 *
 * A till is useless if it stops selling when the network hiccups, so a sale
 * that cannot reach the server is stored locally and replayed on reconnect.
 *
 * Safety rests on the client_uuid minted before the first attempt: the server
 * treats checkout as idempotent on that id, so a request that actually
 * succeeded but whose response was lost cannot ring the sale up twice.
 */
import { api } from "../api/client";

const QUEUE_KEY = "cashier.offlineQueue";

export interface QueuedSale {
  client_uuid: string;
  payload: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
  lastError?: string;
  /** Set when the server rejected it for a reason retrying will not fix. */
  rejected?: boolean;
}

type Listener = (queue: QueuedSale[]) => void;
const listeners = new Set<Listener>();

export function loadQueue(): QueuedSale[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedSale[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  listeners.forEach((fn) => fn(queue));
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function newClientUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function enqueue(clientUuid: string, payload: Record<string, unknown>) {
  const queue = loadQueue();
  if (queue.some((q) => q.client_uuid === clientUuid)) return;
  queue.push({
    client_uuid: clientUuid,
    payload: { ...payload, client_uuid: clientUuid, was_offline: true },
    queuedAt: new Date().toISOString(),
    attempts: 0,
  });
  saveQueue(queue);
}

export function removeFromQueue(clientUuid: string) {
  saveQueue(loadQueue().filter((q) => q.client_uuid !== clientUuid));
}

export function pendingCount(): number {
  return loadQueue().filter((q) => !q.rejected).length;
}

/** A network-level failure — as opposed to the server rejecting the sale. */
export function isOfflineError(err: any): boolean {
  if (err?.response) return false; // server answered, so we were online
  return (
    err?.code === "ERR_NETWORK" ||
    err?.code === "ECONNABORTED" ||
    err?.message === "Network Error" ||
    !navigator.onLine
  );
}

let syncing = false;

export interface SyncResult {
  synced: number;
  failed: number;
  rejected: number;
}

/**
 * Replay queued sales oldest-first.
 *
 * Stops at the first network failure so ordering is preserved and we do not
 * hammer a server that is still down. A 4xx means the sale will never be
 * accepted (e.g. stock ran out while offline); it is flagged for a human
 * rather than retried forever.
 */
export async function syncQueue(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, rejected: 0 };
  if (syncing) return result;
  syncing = true;
  try {
    for (const entry of loadQueue()) {
      if (entry.rejected) {
        result.rejected += 1;
        continue;
      }
      try {
        await api.post("/orders/", entry.payload);
        removeFromQueue(entry.client_uuid);
        result.synced += 1;
      } catch (err: any) {
        if (isOfflineError(err)) {
          result.failed += 1;
          break; // still offline — keep the rest queued, in order
        }
        const queue = loadQueue();
        const target = queue.find((q) => q.client_uuid === entry.client_uuid);
        if (target) {
          target.attempts += 1;
          target.lastError = describeError(err);
          // The server answered with a refusal; retrying will not help.
          if (err?.response?.status >= 400 && err?.response?.status < 500) {
            target.rejected = true;
            result.rejected += 1;
          } else {
            result.failed += 1;
          }
          saveQueue(queue);
        }
      }
    }
  } finally {
    syncing = false;
  }
  return result;
}

export function describeError(err: any): string {
  const data = err?.response?.data;
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.join(" ");
  if (data && typeof data === "object") {
    return (
      data.detail ||
      Object.entries(data)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
        .join(" · ")
    );
  }
  return err?.message || "Unknown error";
}
