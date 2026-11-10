import type { Order, ShiftReport } from "../api/types";
// Embedded rather than linked: the receipt prints from a data:text/html
// window, which cannot load the app's own files.
import receiptLogo from "../assets/brand/receipt-logo.jpg?dataurl";
import { BRAND } from "../brand/brand";
import { formatDateTime, getLang, getMessages, label } from "../i18n";
import { platform } from "../platform";
import { orderToEscPos, shiftReportToEscPos } from "./escposReceipt";

function money(v: string | number): string {
  return Number(v).toFixed(2);
}

/** Trim trailing zeros: "3.000" -> "3", "1.250" -> "1.25". */
function qty(v: string | number): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** The print-dialog receipt, in the app's current language. */
export function buildReceiptHtml(order: Order, opts: { copy?: boolean } = {}): string {
  const lang = getLang();
  const t = getMessages();
  const r = t.receipt;
  const rtl = lang === "ar";

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
    body { width: 280px; margin: 0 auto; color: #000; }
    .logo { display: block; width: 150px; margin: 4px auto; }
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
      <tr><td>${escapeHtml(r.discount)}</td><td class="r">-${money(order.discount)}</td></tr>
      <tr><td>${escapeHtml(r.tax)}</td><td class="r">${money(order.tax)}</td></tr>
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

/**
 * Print a sale.
 *
 * Prefers the thermal printer (silent, instant, and can kick the drawer) and
 * falls back to the HTML print dialog when no ESC/POS printer is configured
 * or it fails — a printer fault must never block the queue.
 */
export async function printOrderReceipt(
  order: Order,
  opts: { copy?: boolean; openDrawer?: boolean } = {}
): Promise<void> {
  const thermal = await platform.printEscPos(orderToEscPos(order, opts));
  if (!thermal.success) {
    await platform.printReceipt(buildReceiptHtml(order, opts));
    return;
  }
  // Only pop the drawer when cash actually changed hands.
  const tookCash = (order.payments ?? []).some((p) => p.method === "CASH");
  if (opts.openDrawer ?? tookCash) {
    await platform.openCashDrawer();
  }
}

export async function printShiftReport(
  report: ShiftReport,
  kind: "X" | "Z"
): Promise<{ success: boolean; error?: string }> {
  return platform.printEscPos(shiftReportToEscPos(report, kind));
}
