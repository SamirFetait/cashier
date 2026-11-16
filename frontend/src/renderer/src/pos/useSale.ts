import { notifications } from "@mantine/notifications";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import type { Customer, Order, Paginated, Product, Shift } from "../api/types";
import { useI18n } from "../i18n";
import { printOrderReceipt } from "../receipt/receipt";
import { enqueue, isOfflineError, newClientUuid } from "./offlineQueue";
import type { TenderLine } from "./PaymentModal";

export interface CartLine {
  product: Product;
  quantity: number;
  discount: number;
}

export interface HeldSale {
  id: string;
  label: string;
  cart: CartLine[];
  customerId: string | null;
  heldAt: string;
}

/** Shared by every till screen, so a sale held on one resumes on another. */
const HELD_KEY = "cashier.heldSales";

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The line before its discount: price × quantity. */
export const lineGross = (line: Pick<CartLine, "product" | "quantity">) =>
  round2(Number(line.product.price) * line.quantity);

export const lineTotal = (line: CartLine) => round2(lineGross(line) - line.discount);

/** Where the last sale's receipt stands, for the "print again" button. */
export interface ReceiptState {
  order: Order;
  status: "printing" | "printed" | "notPrinted";
  error?: string;
}

/**
 * A receipt for a sale the server has not seen yet.
 *
 * The customer still needs paper, so we synthesise an Order shape locally.
 * It carries no receipt number — that is issued by the server when the queue
 * syncs — and is marked so nobody mistakes it for a filed sale.
 */
function buildOfflineOrder(
  payload: any,
  payments: TenderLine[],
  total: number,
  products: Product[]
): Order {
  return {
    id: 0,
    receipt_number: null,
    customer: payload.customer,
    customer_name: null,
    storage: 0,
    created_by: null,
    created_by_username: null,
    shift: null,
    shift_number: null,
    status: "COMPLETED",
    payment_method: payments[0]?.method ?? "CASH",
    subtotal: String(total + Number(payload.discount || 0)),
    discount: String(payload.discount || 0),
    tax: "0",
    total: String(total),
    amount_paid: String(total),
    change_given: String(
      payments.reduce((s, p) => s + Math.max(0, (p.tendered ?? 0) - p.amount), 0)
    ),
    note: "OFFLINE — awaiting sync",
    items: payload.items.map((line: any, index: number) => {
      const product = products[index];
      return {
        id: index,
        product: line.product,
        product_name: product?.name ?? `Item ${line.product}`,
        product_unit: product?.unit ?? "",
        sold_by: product?.sold_by ?? "UNIT",
        quantity: String(line.quantity),
        unit_price: String(product?.price ?? "0"),
        discount: String(line.discount || 0),
        line_total: String(
          Number(product?.price ?? 0) * Number(line.quantity) - Number(line.discount || 0)
        ),
      };
    }),
    payments: payments.map((p, i) => ({
      id: i,
      method: p.method,
      amount: String(p.amount),
      tendered: String(p.tendered ?? 0),
      change: String(Math.max(0, (p.tendered ?? 0) - p.amount)),
      reference: p.reference ?? "",
      created_at: new Date().toISOString(),
    })),
    created_at: new Date().toISOString(),
  };
}

function loadHeld(): HeldSale[] {
  try {
    return JSON.parse(localStorage.getItem(HELD_KEY) || "[]");
  } catch {
    return [];
  }
}

/**
 * One sale at the till: the cart, held sales, and checkout (online, offline,
 * or after a manager's PIN). Screens own only their layout.
 *
 * `onCompleted` runs once the sale is settled, with the server's order or,
 * when offline, the locally built one (receipt_number null).
 */
export function useSale(options: { onCompleted?: (order: Order, offline: boolean) => void } = {}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderDiscount, setOrderDiscount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [held, setHeld] = useState<HeldSale[]>(loadHeld);
  // Payments waiting on a manager's PIN; the prompt shows while set.
  const [pinPayments, setPinPayments] = useState<TenderLine[] | null>(null);
  const onCompleted = useRef(options.onCompleted);
  onCompleted.current = options.onCompleted;

  const shift = useQuery({
    queryKey: ["shift", "current"],
    queryFn: async () =>
      (await api.get<{ shift: Shift | null }>("/shifts/current/")).data.shift,
  });

  const products = useQuery({
    queryKey: ["products", "active"],
    queryFn: async () =>
      (await api.get<Paginated<Product>>("/products/?is_active=true&page_size=500")).data
        .results,
  });
  const customers = useQuery({
    queryKey: ["customers"],
    queryFn: async () =>
      (await api.get<Paginated<Customer>>("/customers/?page_size=500")).data.results,
  });

  useEffect(() => {
    localStorage.setItem(HELD_KEY, JSON.stringify(held));
  }, [held]);

  /** The active product with this barcode: the loaded list first, then the server. */
  async function findByBarcode(code: string): Promise<Product | null> {
    const local = products.data?.find((p) => p.barcode === code);
    if (local) return local;
    return api
      .get<Product>(`/products/lookup/?barcode=${encodeURIComponent(code)}`)
      .then((r) => r.data)
      .catch(() => null);
  }

  function addProduct(product: Product, quantity = 1) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: l.quantity + quantity } : l
        );
      }
      return [...prev, { product, quantity, discount: 0 }];
    });
  }

  // A line's discount never exceeds what the line costs, so fewer pieces
  // after a discount cannot make the server refuse the sale.
  function setQty(id: number, qty: number) {
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== id) return l;
        const quantity = Math.max(0, qty);
        return { ...l, quantity, discount: Math.min(l.discount, lineGross({ ...l, quantity })) };
      })
    );
  }

  function setLineDiscount(id: number, value: number) {
    setCart((prev) =>
      prev.map((l) =>
        l.product.id === id
          ? { ...l, discount: round2(Math.min(Math.max(0, value), lineGross(l))) }
          : l
      )
    );
  }

  function removeLine(id: number) {
    setCart((prev) => prev.filter((l) => l.product.id !== id));
  }

  const subtotal = useMemo(
    () =>
      round2(
        cart.reduce((s, l) => s + Number(l.product.price) * l.quantity - l.discount, 0)
      ),
    [cart]
  );
  /** Before any discount, and what the item discounts take off it. */
  const gross = useMemo(() => round2(cart.reduce((s, l) => s + lineGross(l), 0)), [cart]);
  const itemsDiscount = round2(gross - subtotal);
  const total = round2(Math.max(0, subtotal - orderDiscount));

  const [receipt, setReceipt] = useState<ReceiptState | null>(null);

  /** Print a settled sale. Its outcome only ever changes the receipt state:
   *  the sale is recorded whatever the printer does. */
  async function printReceipt(order: Order, again = false) {
    setReceipt({ order, status: "printing" });
    // A second copy is marked as one, and never pops the drawer again.
    const result = await printOrderReceipt(order, again ? { copy: true, openDrawer: false } : {});
    if (result.success) {
      setReceipt({ order, status: "printed" });
      return;
    }
    setReceipt({ order, status: "notPrinted", error: result.error });
    if (!result.cancelled) {
      notifications.show({
        title: t.newOrder.receiptFailed,
        message: result.error || t.newOrder.receiptFailedHint,
        color: "orange",
      });
    }
  }

  function clearSale() {
    setCart([]);
    setCustomerId(null);
    setOrderDiscount(0);
  }

  function holdSale() {
    if (cart.length === 0) return;
    const label =
      customers.data?.find((c) => String(c.id) === customerId)?.name ||
      t.newOrder.heldLabel(cart.length, total.toFixed(2));
    setHeld((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        label,
        cart,
        customerId,
        heldAt: new Date().toISOString(),
      },
    ]);
    clearSale();
    notifications.show({ title: t.newOrder.saleHeld, message: label, color: "teal" });
  }

  function resumeSale(sale: HeldSale) {
    if (cart.length > 0) {
      notifications.show({
        title: t.newOrder.busyTitle,
        message: t.newOrder.busyMessage,
        color: "orange",
      });
      return;
    }
    setCart(sale.cart);
    setCustomerId(sale.customerId);
    setHeld((prev) => prev.filter((h) => h.id !== sale.id));
  }

  const invalidLines = cart.filter(
    (l) =>
      l.quantity <= 0 ||
      (l.product.sold_by === "UNIT" && !Number.isInteger(l.quantity))
  );

  async function checkout(payments: TenderLine[], pin = "") {
    setSubmitting(true);
    // Minted before the first attempt so a retry — or an offline replay —
    // cannot ring the same sale up twice.
    const clientUuid = newClientUuid();
    const payload = {
      customer: customerId ? Number(customerId) : null,
      discount: orderDiscount,
      override_pin: pin,
      client_uuid: clientUuid,
      items: cart.map((l) => ({
        product: l.product.id,
        quantity: l.quantity,
        discount: l.discount,
      })),
      payments: payments.map((p) => ({
        method: p.method,
        amount: p.amount,
        tendered: p.tendered ?? 0,
        reference: p.reference ?? "",
      })),
    };
    let settled: Order;
    try {
      const resp = await api.post<Order>("/orders/", payload);
      settled = resp.data;
      const change = Number(resp.data.change_given || 0);
      notifications.show({
        title: t.newOrder.saleDone(resp.data.receipt_number ?? ""),
        message: t.newOrder.saleTotal(
          Number(resp.data.total).toFixed(2),
          change > 0 ? change.toFixed(2) : undefined
        ),
        color: "green",
      });
      clearSale();
      onCompleted.current?.(resp.data, false);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["summary"] });
      qc.invalidateQueries({ queryKey: ["shift"] });
      qc.invalidateQueries({ queryKey: ["orders", "next-number"] });
    } catch (err: any) {
      // Network down: bank the sale locally rather than losing it. The
      // customer is served now and the queue syncs when the link returns.
      if (isOfflineError(err)) {
        enqueue(clientUuid, payload);
        const offlineOrder = buildOfflineOrder(
          payload, payments, total, cart.map((l) => l.product)
        );
        notifications.show({
          title: t.newOrder.savedOffline,
          message: t.newOrder.savedOfflineMessage,
          color: "yellow",
        });
        clearSale();
        onCompleted.current?.(offlineOrder, true);
        setSubmitting(false);
        void printReceipt(offlineOrder);
        return;
      }
      const data = err?.response?.data;
      // The server decides what counts as a "large" discount; when it asks for
      // a supervisor we prompt rather than duplicating the threshold here.
      if (data?.override_pin) {
        setPinPayments(payments);
        setSubmitting(false);
        if (pin) {
          notifications.show({
            title: t.newOrder.pinRejected,
            message: String(data.override_pin),
            color: "red",
          });
        }
        return;
      }
      const detail =
        data?.detail ||
        (Array.isArray(data) ? data.join(" ") : null) ||
        (data && typeof data === "object"
          ? Object.entries(data)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`)
              .join(" · ")
          : t.newOrder.checkoutFailed);
      notifications.show({ title: t.newOrder.checkoutFailed, message: detail, color: "red" });
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    // Only now, outside the sale's own error handling: the sale is recorded,
    // so whatever the printer does cannot look like a failed checkout.
    void printReceipt(settled);
  }

  return {
    shift,
    products,
    customers,
    cart,
    customerId,
    setCustomerId,
    orderDiscount,
    setOrderDiscount,
    subtotal,
    gross,
    itemsDiscount,
    total,
    /** The last sale's receipt, and printing it (again). */
    receipt,
    printReceipt,
    invalidLines,
    held,
    submitting,
    findByBarcode,
    addProduct,
    setQty,
    setLineDiscount,
    removeLine,
    clearSale,
    holdSale,
    resumeSale,
    checkout,
    /** The manager-PIN prompt for a discount above the cashier's limit. */
    pin: {
      opened: pinPayments !== null,
      close: () => setPinPayments(null),
      submit: (pin: string) => {
        const payments = pinPayments;
        setPinPayments(null);
        if (payments) void checkout(payments, pin);
      },
    },
  };
}
