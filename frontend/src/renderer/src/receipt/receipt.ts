import type { Order } from "../api/types";
import { platform } from "../platform";

const STORE_NAME = "Cashier POS";

function money(v: string | number): string {
  return Number(v).toFixed(2);
}

export function buildReceiptHtml(order: Order): string {
  const rows = order.items
    .map(
      (it) => `
      <tr>
        <td>${escapeHtml(it.product_name)}</td>
        <td class="r">${it.quantity}</td>
        <td class="r">${money(it.unit_price)}</td>
        <td class="r">${money(it.line_total)}</td>
      </tr>`
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
  </style></head>
  <body>
    <h2>${STORE_NAME}</h2>
    <div class="muted">Receipt #${order.id}</div>
    <div class="muted">${new Date(order.created_at).toLocaleString()}</div>
    <div class="muted">${order.customer_name ? "Customer: " + escapeHtml(order.customer_name) : "Walk-in customer"}</div>
    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${money(order.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="r">-${money(order.discount)}</td></tr>
      <tr><td>Tax</td><td class="r">${money(order.tax)}</td></tr>
      <tr class="grand"><td>TOTAL</td><td class="r">${money(order.total)}</td></tr>
      <tr><td>Paid by</td><td class="r">${escapeHtml(order.payment_method)}</td></tr>
    </table>
    <div class="center">Thank you for your purchase!</div>
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
