import type { Lang } from "../i18n";
import { encodeBarcode, type BarcodeSymbol } from "./barcode";

/** What one label shows. */
export interface LabelContent {
  storeName: string;
  name: string;
  category: string | null;
  /** Already formatted, currency included. */
  price: string;
  barcode: string;
}

export interface LabelPage {
  content: LabelContent;
  copies: number;
}

// Label printers print 8 dots per millimetre (203 dpi). A module that is a
// whole number of dots keeps every bar exactly as wide as the next, which is
// what scanners depend on.
const DOT_MM = 0.125;
/** Narrower than this, a module (and so the barcode) stops reading reliably. */
export const MIN_MODULE_MM = 0.25;
/** Kept clear around the label: printers lose a little at the edges. */
const PAD_X_MM = 1.5;
const PAD_Y_MM = 1;

/** Module width that fits the symbol, quiet zones included, across the label. */
export function moduleWidthMm(symbol: BarcodeSymbol, labelWidthMm: number): number {
  const modules = symbol.quietLeft + symbol.modules.length + symbol.quietRight;
  const available = labelWidthMm - 2 * PAD_X_MM;
  for (const dots of [3, 2]) {
    if (modules * dots * DOT_MM <= available) return dots * DOT_MM;
  }
  return available / modules;
}

/** Whether the code prints large enough on this label width to scan reliably. */
export function barcodeFits(barcode: string, labelWidthMm: number): boolean {
  const symbol = encodeBarcode(barcode);
  return !!symbol && moduleWidthMm(symbol, labelWidthMm) >= MIN_MODULE_MM;
}

function barsSvg(symbol: BarcodeSymbol, moduleMm: number): string {
  const total = symbol.quietLeft + symbol.modules.length + symbol.quietRight;
  let rects = "";
  const m = symbol.modules;
  for (let i = 0; i < m.length; ) {
    if (m[i] !== "1") {
      i++;
      continue;
    }
    let end = i;
    while (m[end] === "1") end++;
    rects += `<rect x="${symbol.quietLeft + i}" width="${end - i}" height="1"/>`;
    i = end;
  }
  // Drawn in module units and stretched to the label: one rect per bar, crisp
  // edges, no anti-aliasing to blur them.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${(total * moduleMm).toFixed(3)}mm" viewBox="0 0 ${total} 1" preserveAspectRatio="none" shape-rendering="crispEdges">${rects}</svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function labelBody(content: LabelContent, widthMm: number): string {
  const symbol = encodeBarcode(content.barcode);
  const bars = symbol ? barsSvg(symbol, moduleWidthMm(symbol, widthMm)) : "";
  return `<section class="label">
    ${content.storeName ? `<div class="store">${escapeHtml(content.storeName)}</div>` : ""}
    <div class="name">${escapeHtml(content.name)}</div>
    ${content.category ? `<div class="category">${escapeHtml(content.category)}</div>` : ""}
    <div class="bars">${bars}</div>
    <div class="digits">${escapeHtml(content.barcode)}</div>
    <div class="price">${escapeHtml(content.price)}</div>
  </section>`;
}

/**
 * A document of label-sized pages, one per printed label.
 *
 * Text is drawn by the browser and sent to the printer's Windows driver as
 * graphics, which is how Arabic prints on a label printer whose built-in
 * fonts are Latin only. `preview` enlarges it and outlines the label edge.
 */
export function buildLabelsHtml(
  pages: LabelPage[],
  size: { widthMm: number; heightMm: number },
  lang: Lang,
  options: { preview?: number } = {}
): string {
  const { widthMm: w, heightMm: h } = size;
  // Type scales with the label: these sizes suit the common 40 x 30 mm label.
  const k = Math.min(h / 30, w / 40, 1.6);
  const mm = (value: number) => `${(value * k).toFixed(2)}mm`;
  const body = pages
    .flatMap(({ content, copies }) => Array.from({ length: copies }, () => labelBody(content, w)))
    .join("");
  const preview = options.preview
    ? `html { zoom: ${options.preview}; background: #e9ecef; }
       body { padding: 2mm; }
       .label { background: #fff; outline: 0.2mm dashed #868e96; }`
    : "";

  return `<!doctype html><html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8" />
  <style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #fff; color: #000; }
    body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
    .label {
      width: ${w}mm; height: ${h}mm; padding: ${PAD_Y_MM}mm ${PAD_X_MM}mm;
      display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      text-align: center; overflow: hidden; break-after: page;
    }
    .label:last-child { break-after: auto; }
    .store, .name, .category, .digits, .price { max-width: 100%; line-height: 1.15; }
    .store, .category { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .store { font-size: ${mm(2.3)}; font-weight: 700; }
    .name {
      font-size: ${mm(3)}; font-weight: 700;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    /* Thin strokes break up on a thermal head; nothing on the label is lighter than this. */
    .category { font-size: ${mm(2.1)}; font-weight: 600; }
    .bars { flex: 1 1 auto; min-height: ${mm(5)}; width: 100%; display: flex; justify-content: center; padding-top: ${mm(0.6)}; }
    .bars svg { height: 100%; display: block; }
    .digits { direction: ltr; font-size: ${mm(2.2)}; letter-spacing: 0.08em; font-family: Arial, sans-serif; }
    .price { font-size: ${mm(3.9)}; font-weight: 800; white-space: nowrap; }
    ${preview}
  </style></head><body>${body}</body></html>`;
}
