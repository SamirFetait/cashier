import type { Order, ShiftReport } from "../api/types";
import { BRAND } from "../brand/brand";

export interface ReceiptLine {
  left?: string;
  right?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  double?: boolean;
  rule?: boolean;
  feed?: number;
}

// Printed in the printer's built-in Latin font, so the English name only.
const STORE_NAME = BRAND.name.toUpperCase();

function money(v: string | number): string {
  return Number(v).toFixed(2);
}

function qty(v: string | number): string {
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)));
}

/** Order -> ESC/POS line list. Kept declarative so the main process owns layout. */
export function orderToEscPos(order: Order, opts: { copy?: boolean } = {}): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { left: STORE_NAME, align: "center", bold: true, double: true },
    { left: `WhatsApp ${BRAND.whatsapp.display}`, align: "center" },
  ];

  if (opts.copy) lines.push({ left: "*** REPRINT ***", align: "center", bold: true });
  if (order.status !== "COMPLETED") {
    lines.push({ left: order.status.replace("_", " "), align: "center", bold: true });
  }

  lines.push(
    { left: `Receipt ${order.receipt_number ?? `#${order.id}`}`, align: "center" },
    { left: new Date(order.created_at).toLocaleString(), align: "center" }
  );
  if (order.created_by_username) {
    lines.push({ left: `Served by ${order.created_by_username}`, align: "center" });
  }
  lines.push(
    { left: order.customer_name ?? "Walk-in customer", align: "center" },
    { rule: true }
  );

  for (const item of order.items) {
    const unit = item.sold_by === "WEIGHT" ? ` ${item.product_unit}` : "";
    lines.push({ left: item.product_name });
    lines.push({
      left: `  ${qty(item.quantity)}${unit} x ${money(item.unit_price)}`,
      right: money(item.line_total),
    });
    if (Number(item.discount) > 0) {
      lines.push({ left: "  discount", right: `-${money(item.discount)}` });
    }
  }

  lines.push({ rule: true });
  lines.push({ left: "Subtotal", right: money(order.subtotal) });
  if (Number(order.discount) > 0) {
    lines.push({ left: "Discount", right: `-${money(order.discount)}` });
  }
  if (Number(order.tax) > 0) {
    lines.push({ left: "Tax", right: money(order.tax) });
  }
  lines.push({ left: "TOTAL", right: money(order.total), bold: true });
  lines.push({ rule: true });

  for (const payment of order.payments ?? []) {
    lines.push({
      left: payment.method + (payment.reference ? ` ${payment.reference}` : ""),
      right: money(payment.amount),
    });
    if (Number(payment.tendered) > 0) {
      lines.push({ left: "  Tendered", right: money(payment.tendered) });
    }
    if (Number(payment.change) > 0) {
      lines.push({ left: "  Change", right: money(payment.change), bold: true });
    }
  }

  lines.push(
    { feed: 1 },
    { left: "Thank you for your purchase!", align: "center" },
    { left: "Keep this receipt for returns", align: "center" }
  );
  return lines;
}

/** X/Z report -> ESC/POS. Printed at close so the drawer count has a paper record. */
export function shiftReportToEscPos(
  report: ShiftReport,
  kind: "X" | "Z"
): ReceiptLine[] {
  const lines: ReceiptLine[] = [
    { left: `${kind} REPORT`, align: "center", bold: true, double: true },
    { left: STORE_NAME, align: "center" },
    { left: `Shift ${report.shift}`, align: "center" },
  ];
  if (report.terminal) lines.push({ left: report.terminal, align: "center" });
  lines.push(
    { left: `Opened by ${report.opened_by ?? "—"}`, align: "center" },
    { left: new Date(report.generated_at).toLocaleString(), align: "center" },
    { rule: true },
    { left: "Opening float", right: money(report.opening_float) },
    { left: `Sales (${report.order_count})`, right: money(report.sales_total) },
    { left: "Voids", right: String(report.void_count) },
    { left: "Refunds", right: String(report.refund_count) },
    { rule: true }
  );

  for (const payment of report.payments) {
    lines.push({
      left: `${payment.method} (${payment.count})`,
      right: money(payment.total),
    });
  }
  lines.push({ rule: true });
  for (const movement of report.cash_movements) {
    lines.push({ left: movement.kind, right: money(movement.total) });
  }

  lines.push(
    { rule: true },
    { left: "Expected cash", right: money(report.expected_cash), bold: true }
  );
  if (report.counted_cash !== null) {
    lines.push({ left: "Counted cash", right: money(report.counted_cash) });
    lines.push({
      left: "VARIANCE",
      right: money(report.variance ?? 0),
      bold: true,
      double: true,
    });
  }
  return lines;
}
