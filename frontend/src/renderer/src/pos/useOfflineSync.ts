import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { loadQueue, subscribe, syncQueue, type QueuedSale } from "./offlineQueue";

/**
 * Watches connectivity and drains the offline queue.
 *
 * `navigator.onLine` only reports the link, not whether our server is
 * reachable, so a periodic retry backs it up while anything is queued.
 */
export function useOfflineSync(pollMs = 30000) {
  const qc = useQueryClient();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queue, setQueue] = useState<QueuedSale[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);

  const pending = queue.filter((q) => !q.rejected).length;
  const rejected = queue.filter((q) => q.rejected).length;

  const drain = useCallback(async () => {
    if (loadQueue().length === 0) return;
    setSyncing(true);
    const result = await syncQueue();
    setSyncing(false);
    if (result.synced > 0) {
      // Stock and totals moved on the server; refresh what the UI shows.
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    }
    return result;
  }, [qc]);

  useEffect(() => subscribe(setQueue), []);

  useEffect(() => {
    function goOnline() {
      setOnline(true);
      void drain();
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [drain]);

  useEffect(() => {
    void drain();
  }, [drain]);

  useEffect(() => {
    if (pending === 0) return;
    const id = setInterval(() => void drain(), pollMs);
    return () => clearInterval(id);
  }, [pending, pollMs, drain]);

  return { online, pending, rejected, queue, syncing, sync: drain };
}
