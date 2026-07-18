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
  options: {
    enabled?: boolean;
    maxKeyIntervalMs?: number;
    minLength?: number;
    maxEnterDelayMs?: number;
  } = {}
) {
  const {
    enabled = true,
    maxKeyIntervalMs = 50,
    minLength = 3,
    // Scanners commonly hold the terminating Enter back by a few tens of
    // milliseconds; that pause must not be read as "a human typed this".
    maxEnterDelayMs = 250,
  } = options;
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const inTextField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      // The dedicated scan box handles its own Enter, because it must also
      // accept a barcode typed in by hand when a label will not scan. Firing
      // here as well would add the item twice on every scan — and since the
      // till keeps that box focused, that is the normal path, not an edge case.
      if (inTextField && target!.getAttribute("data-scan") === "true") return;

      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (event.key === "Enter") {
        const code = buffer.current;
        buffer.current = "";
        // The buffer only ever reaches minLength if the characters arrived at
        // machine speed, so its length is the real evidence of a scan; Enter
        // itself only has to be prompt, not instant. Any other text field is
        // left alone — the cashier may be typing a note or a quantity there.
        if (!inTextField && code.length >= minLength && gap <= maxEnterDelayMs) {
          event.preventDefault();
          handler.current(code);
        }
        return;
      }

      // A pause means a new burst: anything buffered was not part of this one.
      if (gap > maxKeyIntervalMs) buffer.current = "";

      // Modifier combos (Ctrl+V and friends) are not scanner output, and would
      // otherwise leave stray characters in the buffer.
      if (event.key.length === 1) {
        if (event.ctrlKey || event.metaKey || event.altKey) buffer.current = "";
        else buffer.current += event.key;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, maxKeyIntervalMs, minLength, maxEnterDelayMs]);
}
