// The saved interface language, without React, so the startup splash can read
// it too (see splash.ts).

export type Lang = "en" | "ar";

export const LANG_STORAGE_KEY = "cashier.lang";

export function storedLang(): Lang {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");
