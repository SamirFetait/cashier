// The saved interface language, without React, so the startup splash can read
// it too (see splash.ts).

export type Lang = "en" | "ar";

export const LANG_STORAGE_KEY = "cashier.lang";

/** What a terminal shows until someone switches the language on it. */
export const DEFAULT_LANG: Lang = "ar";

export function storedLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === "en" || saved === "ar" ? saved : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");
