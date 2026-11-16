import type { Order, ShiftReport } from "../api/types";
// Embedded rather than linked: the receipt prints from a data:text/html
// window, which cannot load the app's own files.
import receiptLogo from "../assets/brand/receipt-logo.jpg?dataurl";
import { BRAND } from "../brand/brand";
import { formatDateTime, getLang, getMessages, label } from "../i18n";
import { platform } from "../platform";
import { orderToEscPos, shiftReportToEscPos, type ReceiptLine } from "./escposReceipt";

function money(v: string | number): string {
  return Number(v).toFixed(2);
}

/** Trim trailing zeros: "3.000" -> "3", "1.250" -> "1.25". */
function qty(v: string | number): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** How this terminal prints receipts. Saved per terminal by the main process. */
export interface PrinterConfig {
  transport: "network" | "device" | "windows" | "none";
  host?: string;
  port?: number;
  path?: string;
  /** "windows": the installed printer's name, as Windows lists it. */
  printer?: string;
  /** Characters per line: 32 for 58mm paper, 42 for 80mm. */
  width?: number;
}

export interface PrintResult {
  success: boolean;
  error?: string;
  /** The print dialog was closed without printing: not a fault. */
  cancelled?: boolean;
}

/** The printable width of the paper roll, from the characters per line. */
function paperWidthMm(chars: number | undefined): number {
  return (chars ?? 42) <= 32 ? 48 : 72;
}

/** The receipt as a page, in the app's current language: for the print
 * dialog, and for printers printed to through their Windows driver. */
export function buildReceiptHtml(
  order: Order,
  opts: { copy?: boolean; widthMm?: number } = {}
): string {
  const lang = getLang();
  const t = getMessages();
  const r = t.receipt;
  const rtl = lang === "ar";
  const widthMm = opts.widthMm ?? 72;

  const rows = order.items
    .map(
      (it) => `
      <tr>
        <td>${escapeHtml(it.product_name)}</td>
        <td class="r">${qty(it.quantity)}${it.sold_by === "WEIGHT" ? " " + escapeHtml(it.product_unit) : ""}</td>
        <td class="r">${money(it.unit_price)}</td>
        <td class="r">${money(it.line_total)}</td>
      </tr>${
        Number(it.discount) > 0
          ? `<tr><td colspan="3" class="disc">  ${escapeHtml(r.lineDiscount)}</td><td class="r disc">-${money(it.discount)}</td></tr>`
          : ""
      }`
    )
    .join("");

  const paymentRows = (order.payments ?? [])
    .map(
      (p) => `
      <tr><td>${escapeHtml(label(t.paymentMethods, p.method))}${p.reference ? " " + escapeHtml(p.reference) : ""}</td><td class="r">${money(p.amount)}</td></tr>
      ${Number(p.tendered) > 0 ? `<tr><td>  ${escapeHtml(r.tendered)}</td><td class="r">${money(p.tendered)}</td></tr>` : ""}
      ${Number(p.change) > 0 ? `<tr><td>  ${escapeHtml(r.change)}</td><td class="r">${money(p.change)}</td></tr>` : ""}`
    )
    .join("");

  // Arabic reads poorly in a monospace face. Amount columns stay
  // left-to-right so a minus sign keeps its place, and sit at the outer edge
  // of the page in either direction.
  return `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8" />
  <style>
    * { font-family: ${rtl ? "'Segoe UI', Tahoma, Arial, sans-serif" : "'Courier New', monospace"}; }
    @page { margin: 0; }
    body { width: ${widthMm}mm; margin: 0 auto; color: #000; }
    .logo { display: block; width: ${Math.round(widthMm * 0.55)}mm; margin: 4px auto; }
    .muted { color: #444; font-size: 11px; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { padding: 2px 0; }
    th { border-bottom: 1px dashed #000; text-align: start; }
    .r { direction: ltr; text-align: ${rtl ? "left" : "right"}; }
    .totals td { padding-top: 2px; }
    .grand { font-weight: bold; border-top: 1px dashed #000; }
    .center { text-align: center; margin-top: 10px; font-size: 12px; }
    .disc { font-size: 11px; color: #444; }
    .copy { text-align: center; font-weight: bold; font-size: 12px; margin: 4px 0; text-transform: uppercase; }
  </style></head>
  <body>
    <img class="logo" src="${receiptLogo}" alt="${escapeHtml(BRAND.name)}" />
    <div class="muted">${escapeHtml(t.common.whatsapp)} <span dir="ltr">${escapeHtml(BRAND.whatsapp.display)}</span></div>
    ${opts.copy ? `<div class="copy">${escapeHtml(r.reprint)}</div>` : ""}
    <div class="muted">${escapeHtml(r.number(order.receipt_number ?? `#${order.id}`))}</div>
    <div class="muted">${escapeHtml(formatDateTime(order.created_at, lang))}</div>
    ${order.created_by_username ? `<div class="muted">${escapeHtml(r.servedBy(order.created_by_username))}</div>` : ""}
    <div class="muted">${escapeHtml(order.customer_name ? r.customer(order.customer_name) : r.walkIn)}</div>
    ${order.status !== "COMPLETED" ? `<div class="copy">${escapeHtml(label(t.orderStatus, order.status))}</div>` : ""}
    <table>
      <thead><tr><th>${escapeHtml(r.item)}</th><th class="r">${escapeHtml(r.qty)}</th><th class="r">${escapeHtml(r.price)}</th><th class="r">${escapeHtml(r.total)}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>${escapeHtml(r.subtotal)}</td><td class="r">${money(order.subtotal)}</td></tr>
      ${Number(order.discount) > 0 ? `<tr><td>${escapeHtml(r.discount)}</td><td class="r">-${money(order.discount)}</td></tr>` : ""}
      ${Number(order.tax) > 0 ? `<tr><td>${escapeHtml(r.tax)}</td><td class="r">${money(order.tax)}</td></tr>` : ""}
      <tr class="grand"><td>${escapeHtml(r.grandTotal)}</td><td class="r">${money(order.total)}</td></tr>
      ${paymentRows || `<tr><td>${escapeHtml(r.paidBy)}</td><td class="r">${escapeHtml(label(t.paymentMethods, order.payment_method))}</td></tr>`}
    </table>
    <div class="center">${escapeHtml(r.thanks)}</div>
    ${order.receipt_number ? `<div class="center muted">${escapeHtml(r.keep)}</div>` : ""}
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

async function printerConfig(): Promise<PrinterConfig> {
  try {
    const config = (await platform.getPrinterConfig()) as PrinterConfig | null;
    return config?.transport ? config : { transport: "none" };
  } catch {
    return { transport: "none" };
  }
}

function asResult(result: { success: boolean; error?: string }): PrintResult {
  if (result.success) return { success: true };
  return { success: false, error: result.error, cancelled: result.error === "cancelled" };
}

/**
 * Print a sale. Never throws: by the time it prints, the sale is recorded,
 * and a printer fault must not make it look otherwise.
 *
 * - "windows": silently, through the printer's own Windows driver (Arabic and
 *   the logo print; the driver opens the drawer if it is set to).
 * - "network" / "device": raw ESC/POS, silent and instant, and the drawer is
 *   kicked for a cash sale.
 * - otherwise, or if the thermal printer fails: the print dialog.
 */
export async function printOrderReceipt(
  order: Order,
  opts: { copy?: boolean; openDrawer?: boolean } = {}
): Promise<PrintResult> {
  try {
    const config = await printerConfig();
    if (config.transport === "windows" && config.printer) {
      const html = buildReceiptHtml(order, { ...opts, widthMm: paperWidthMm(config.width) });
      return asResult(await platform.printReceipt(html, config.printer));
    }
    if (config.transport === "network" || config.transport === "device") {
      const thermal = await platform.printEscPos(orderToEscPos(order, opts));
      if (thermal.success) {
        // Only pop the drawer when cash actually changed hands.
        const tookCash = (order.payments ?? []).some((p) => p.method === "CASH");
        if (opts.openDrawer ?? tookCash) await platform.openCashDrawer();
        return { success: true };
      }
    }
    return asResult(await platform.printReceipt(buildReceiptHtml(order, opts)));
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** ESC/POS lines (a shift report, a test page) as a page for a Windows printer. */
export function linesToHtml(lines: ReceiptLine[], chars = 42): string {
  const pad = (left: string, right: string) => {
    const gap = chars - left.length - right.length;
    return gap >= 1 ? left + " ".repeat(gap) + right : `${left}\n${right.padStart(chars)}`;
  };
  // One block per line; centring is left to CSS, so a double-size line stays centred.
  const body = lines
    .map((line) => {
      if (line.rule) return `<div>${"-".repeat(chars)}</div>`;
      if (line.feed) return "<div>&nbsp;</div>".repeat(line.feed);
      const text = line.right !== undefined ? pad(line.left ?? "", line.right) : (line.left ?? "");
      const style = [
        line.align === "center" || line.align === "right" ? `text-align:${line.align}` : "",
        line.bold ? "font-weight:bold" : "",
        line.double ? "font-size:1.6em" : "",
      ]
        .filter(Boolean)
        .join(";");
      return `<div${style ? ` style="${style}"` : ""}>${escapeHtml(text) || "&nbsp;"}</div>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    @page { margin: 0; }
    body { width: ${paperWidthMm(chars)}mm; margin: 4px auto; color: #000; }
    div { font-family: 'Courier New', monospace; font-size: ${chars <= 32 ? 11 : 10}px; white-space: pre-wrap; }
  </style></head><body>${body}</body></html>`;
}

/** Print ESC/POS lines on whatever this terminal prints receipts with. */
export async function printLines(lines: ReceiptLine[]): Promise<PrintResult> {
  try {
    const config = await printerConfig();
    if (config.transport === "windows" && config.printer) {
      return asResult(await platform.printReceipt(linesToHtml(lines, config.width ?? 42), config.printer));
    }
    return await platform.printEscPos(lines);
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/** Open the cash drawer. A printer printed to through Windows opens it from
 * its own driver settings, not from here. */
export async function openDrawer(): Promise<PrintResult> {
  const config = await printerConfig();
  if (config.transport === "windows") {
    return { success: false, error: getMessages().printer.drawerByDriver };
  }
  return platform.openCashDrawer();
}

export async function printShiftReport(report: ShiftReport, kind: "X" | "Z"): Promise<PrintResult> {
  return printLines(shiftReportToEscPos(report, kind));
}
