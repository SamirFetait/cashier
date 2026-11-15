import { BRAND } from "../brand/brand";

/** Per terminal, like the receipt printer: each till has its own label printer. */
export interface LabelSettings {
  /** Windows printer name; null opens the print dialog every time. */
  printer: string | null;
  widthMm: number;
  heightMm: number;
  storeName: string;
}

/** Common label rolls for Xprinter-style label printers. */
export const LABEL_SIZES = [
  { widthMm: 40, heightMm: 30 },
  { widthMm: 40, heightMm: 25 },
  { widthMm: 50, heightMm: 30 },
  { widthMm: 50, heightMm: 25 },
  { widthMm: 38, heightMm: 25 },
  { widthMm: 60, heightMm: 40 },
];

const KEY = "cashier.labelSettings";

const DEFAULTS: LabelSettings = {
  printer: null,
  widthMm: 40,
  heightMm: 30,
  storeName: BRAND.nameAr,
};

export function loadLabelSettings(): LabelSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

export function saveLabelSettings(settings: LabelSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* still used for this session */
  }
}
