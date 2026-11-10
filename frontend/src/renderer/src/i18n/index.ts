import { useSyncExternalStore } from "react";

import { ar } from "./ar";
import { en, type Messages } from "./en";
import { dirOf, LANG_STORAGE_KEY, storedLang, type Lang } from "./lang";

export { dirOf, type Lang };
export type { Messages };

const MESSAGES: Record<Lang, Messages> = { en, ar };
// Arabic month and day names with Latin digits, so prices, receipt numbers and
// barcodes read the same in both languages. English keeps the system format.
const LOCALES: Record<Lang, string | undefined> = { en: undefined, ar: "ar-EG-u-nu-latn" };

// A module-level store rather than React state: receipts are built outside
// React and need the current language too.
let current: Lang = storedLang();
const listeners = new Set<() => void>();

/** <html lang/dir> drive CSS logical properties and Mantine's RTL rules. */
function applyToDocument(lang: Lang) {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = dirOf(lang);
  document.title = MESSAGES[lang].app.title;
}
applyToDocument(current);

export function getLang(): Lang {
  return current;
}

export function getMessages(): Messages {
  return MESSAGES[current];
}

/** Switch language; remembered per terminal, like the colour scheme. */
export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* still switches for this session */
  }
  applyToDocument(lang);
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatDateTime(value: string | number | Date, lang: Lang = current): string {
  return new Date(value).toLocaleString(LOCALES[lang]);
}

export function formatDate(value: string | number | Date, lang: Lang = current): string {
  return new Date(value).toLocaleDateString(LOCALES[lang]);
}

/**
 * Keep a left-to-right fragment (phone number, signed amount, file path)
 * intact inside right-to-left text; otherwise a leading "+" or "-" jumps to
 * the far end. Invisible isolate marks, so it is safe in plain strings too.
 * Not for thermal receipts: the printer's Latin-1 font has no such marks.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}

/** Display label for a code from the server, falling back to the code itself. */
export function label(labels: Record<string, string>, code: string): string {
  return labels[code] ?? code;
}

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, getLang);
  return {
    lang,
    dir: dirOf(lang),
    t: MESSAGES[lang],
    setLang,
    formatDateTime: (value: string | number | Date) => formatDateTime(value, lang),
    formatDate: (value: string | number | Date) => formatDate(value, lang),
  };
}
