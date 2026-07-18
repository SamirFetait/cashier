import type { Order } from "../api/types";
import { platform } from "../platform";

const STORE_NAME = "Cashier POS";

function money(v: string | number): string {
  return Number(v).toFixed(2);
}

/** Trim trailing zeros: "3.000" -> "3", "1.250" -> "1.25". */
function qty(v: string | number): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

export function buildReceiptHtml(order: Order, opts: { copy?: boolean } = {}): string {
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
          ? `<tr><td colspan="3" class="disc">  discount</td><td class="r disc">-${money(it.discount)}</td></tr>`
          : ""
      }`
    )
    .join("");

  const paymentRows = (order.payments ?? [])
    .map(
      (p) => `
      <tr><td>${escapeHtml(p.method)}${p.reference ? " " + escapeHtml(p.reference) : ""}</td><td class="r">${money(p.amount)}</td></tr>
      ${Number(p.tendered) > 0 ? `<tr><td>  Tendered</td><td class="r">${money(p.tendered)}</td></tr>` : ""}
      ${Number(p.change) > 0 ? `<tr><td>  Change</td><td class="r">${money(p.change)}</td></tr>` : ""}`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" />
  <style>
    * { font-family: 'Courier New', monospace; }
    body { width: 280px; margin: 0 auto; color: #000; }
    h2 { text-align: center; margin: 4px 0; }
    .muted { color: #444; font-size: 11px; text-align: center; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { padding: 2px 0; }
    th { border-bottom: 1px dashed #000; text-align: left; }
    .r { text-align: right; }
    .totals td { padding-top: 2px; }
    .grand { font-weight: bold; border-top: 1px dashed #000; }
    .center { text-align: center; margin-top: 10px; font-size: 12px; }
    .disc { font-size: 11px; color: #444; }
    .copy { text-align: center; font-weight: bold; font-size: 12px; margin: 4px 0; }
  </style></head>
  <body>
    <h2>${STORE_NAME}</h2>
    ${opts.copy ? '<div class="copy">*** REPRINT ***</div>' : ""}
    <div class="muted">Receipt ${escapeHtml(order.receipt_number ?? `#${order.id}`)}</div>
    <div class="muted">${new Date(order.created_at).toLocaleString()}</div>
    ${order.created_by_username ? `<div class="muted">Served by ${escapeHtml(order.created_by_username)}</div>` : ""}
    <div class="muted">${order.customer_name ? "Customer: " + escapeHtml(order.customer_name) : "Walk-in customer"}</div>
    ${order.status !== "COMPLETED" ? `<div class="copy">${escapeHtml(order.status.replace("_", " "))}</div>` : ""}
    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${money(order.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="r">-${money(order.discount)}</td></tr>
      <tr><td>Tax</td><td class="r">${money(order.tax)}</td></tr>
      <tr class="grand"><td>TOTAL</td><td class="r">${money(order.total)}</td></tr>
      ${paymentRows || `<tr><td>Paid by</td><td class="r">${escapeHtml(order.payment_method)}</td></tr>`}
    </table>
    <div class="center">Thank you for your purchase!</div>
    ${order.receipt_number ? `<div class="center muted">Keep this receipt for returns</div>` : ""}
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

export async function printOrderReceipt(order: Order): Promise<void> {
  await platform.printReceipt(buildReceiptHtml(order));
}
