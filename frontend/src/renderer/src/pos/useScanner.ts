import { useEffect, useRef } from "react";

/**
 * Listens for a USB barcode scanner anywhere on the page.
 *
 * Scanners act as keyboard wedges: they type the barcode very fast and finish
 * with Enter. We distinguish that from a human typing by the gap between
 * keystrokes, so the cashier never has to click into a field first — which is
 * the whole point of scanning.
 */
export function useScanner(
  onScan: (code: string) => void,
  options: { enabled?: boolean; maxKeyIntervalMs?: number; minLength?: number } = {}
) {
  const { enabled = true, maxKeyIntervalMs = 50, minLength = 3 } = options;
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      // Let a real text field win — the cashier may be typing a note or a
      // manual quantity. The dedicated scan box opts back in via data-scan.
      const isTyping =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
        target.getAttribute("data-scan") !== "true";

      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (gap > maxKeyIntervalMs) buffer.current = "";

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        if (code.length >= minLength) {
          // Fast burst ending in Enter — treat as a scan even mid-typing.
          if (!isTyping || gap <= maxKeyIntervalMs) {
            event.preventDefault();
            handler.current(code);
          }
        }
        return;
      }

      if (event.key.length === 1) buffer.current += event.key;
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, maxKeyIntervalMs, minLength]);
}
