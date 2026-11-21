export type Role = "SUPERADMIN" | "CASHIER";

export interface User {
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role: Role;
  is_active: boolean;
  /** Server-computed: role is SUPERADMIN *or* the account is a Django superuser. */
  is_superadmin?: boolean;
  has_override_pin?: boolean;
  date_joined: string;
}

export interface Category {
  id: number;
  name: string;
}

export interface Product {
  id: number;
  name: string;
  category: number | null;
  category_name: string | null;
  barcode: string | null;
  price: string;
  cost: string;
  unit: string;
  sold_by: SoldBy;
  is_active: boolean;
  quantity_in_storage: string;
  /** Versioned full-size photo URL (absolute), or null when there is none. */
  image_url: string | null;
  created_at: string;
}

export interface Storage {
  id: number;
  name: string;
  address: string;
  is_default: boolean;
}

export interface Customer {
  id: number;
  name: string;
  phone_number: string;
  address: string;
  notes: string;
  order_count: number;
  total_spent: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  phone_number: string;
  /** The number as wa.me wants it: digits, country code first. */
  whatsapp: string;
  address: string;
  notes: string;
  created_at: string;
}

export type SoldBy = "UNIT" | "WEIGHT";

export type PaymentMethod = "CASH" | "CARD" | "MOBILE" | "VOUCHER" | "OTHER";

export type OrderStatus =
  | "COMPLETED"
  | "CANCELLED"
  | "VOIDED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface OrderItem {
  id: number;
  product: number;
  product_name: string;
  product_unit: string;
  sold_by: SoldBy;
  quantity: string;
  unit_price: string;
  discount: string;
  line_total: string;
}

export interface Payment {
  id: number;
  method: PaymentMethod;
  amount: string;
  tendered: string;
  change: string;
  reference: string;
  created_at: string;
}

export interface Order {
  id: number;
  receipt_number: string | null;
  customer: number | null;
  customer_name: string | null;
  storage: number;
  created_by: number | null;
  created_by_username: string | null;
  shift: number | null;
  shift_number: string | null;
  status: OrderStatus;
  payment_method: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  amount_paid: string;
  change_given: string;
  note: string;
  items: OrderItem[];
  payments: Payment[];
  created_at: string;
}

export interface Shift {
  id: number;
  number: string;
  terminal: string;
  status: "OPEN" | "CLOSED";
  opened_by: number;
  opened_by_username: string;
  opened_at: string;
  closed_by: number | null;
  closed_by_username: string | null;
  closed_at: string | null;
  opening_float: string;
  counted_cash: string | null;
  expected_cash: string | null;
  variance: string | null;
  note: string;
}

export interface ShiftReport {
  shift: string;
  terminal: string;
  status: string;
  opened_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  opening_float: string;
  sales_total: string;
  order_count: number;
  void_count: number;
  refund_count: number;
  payments: { method: string; total: string; count: number }[];
  cash_movements: { kind: string; total: string; count: number }[];
  expected_cash: string;
  counted_cash: string | null;
  variance: string | null;
  generated_at: string;
}

export interface CashMovement {
  id: number;
  shift: number;
  kind: "OPENING_FLOAT" | "SALE" | "REFUND" | "PAY_IN" | "PAY_OUT" | "DROP";
  amount: string;
  reason: string;
  order: number | null;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
}

export interface ReturnItem {
  id: number;
  order_item: number;
  product: number;
  product_name: string;
  quantity: string;
  unit_refund: string;
  line_refund: string;
}

export interface SaleReturn {
  id: number;
  number: string;
  order: number;
  order_receipt: string | null;
  created_by: number | null;
  created_by_username: string | null;
  shift: number | null;
  refund_method: PaymentMethod;
  total: string;
  reason: string;
  restocked: boolean;
  items: ReturnItem[];
  created_at: string;
}

export interface ReturnableLine {
  order_item: number;
  product: string;
  sold: string;
  returnable: string;
}

export interface ReturnableInfo {
  order: string | null;
  status: OrderStatus;
  lines: ReturnableLine[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Summary {
  today_total: number;
  month_total: number;
  month_order_count: number;
  low_stock_count: number;
}

export interface MonthlySales {
  year: number;
  data: { month: number; total: number }[];
}

export interface LowStockRow {
  product: number;
  product_name: string;
  storage_name: string;
  quantity: number;
  reorder_level: number;
}

export interface WhatsAppStatus {
  /** How order alerts go out: Meta's Cloud API, or the sidecar's linked account. */
  provider?: "cloud" | "sidecar";
  connected: boolean;
  /** The sending number (digits), while connected. */
  number?: string | null;
  qr: string | null;
  error?: string | null;
}

export interface BranchInfo {
  code: string;
  name: string;
  hq_configured: boolean;
  report_time: string;
}

export interface DailyReport {
  id: number;
  date: string;
  sales_total: string;
  order_count: number;
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  last_error: string;
  sent_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

// --- Website orders (served by /api/shop/admin/) ---------------------------

export type WebOrderStatus =
  | "AWAITING_DEPOSIT"
  | "DEPOSIT_REVIEW"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export type Fulfilment = "DELIVERY" | "PICKUP";

/** A website order as the board and the search list show it. Money is a string ("12.50"). */
export interface WebOrder {
  id: number;
  code: string;
  status: WebOrderStatus;
  fulfilment: Fulfilment;
  /** The language the customer ordered in; messages to them go out in it. */
  language: "ar" | "en";
  customer_name: string;
  phone: string;
  /** The phone as wa.me wants it: country code first, digits only. */
  whatsapp: string;
  address: string;
  notes: string;
  created_at: string;
  updated_at: string;
  /** When an unpaid delivery stops holding its stock. */
  expires_at: string | null;
  subtotal: string;
  /** A game prize taken off the goods ("0.00" without one), and its code. */
  discount?: string;
  prize_code?: string;
  delivery_fee: string;
  total: string;
  deposit_required: string;
  deposit_paid: string;
  balance_due: string;
  items_count: number;
  items_summary: string[];
  deposit: {
    reference: string;
    sender: string;
    submitted_at: string | null;
    confirmed_at: string | null;
    confirmed_by: string;
    reject_reason: string;
  };
  refund: {
    status: "NONE" | "DUE" | "DONE";
    amount: string;
    reference: string;
    at: string | null;
    by: string;
  };
  pos: {
    /** The cashier sale it became at hand-over. */
    order_id: number | null;
    receipt_number: string;
    total: string | null;
    balance_method: string;
    completed_by: string;
    completed_at: string | null;
  };
  cancel: { reason: string; by: string; at: string | null };
}

export interface WebOrderItem {
  product_id: number;
  name: string;
  unit: string;
  sold_by: SoldBy;
  unit_price: string;
  qty: string;
  line_total: string;
  /** A path on the server ("/api/products/…"), or null. */
  thumb: string | null;
}

export type WebOrderEventKind =
  | "CREATED"
  | "DEPOSIT_SUBMITTED"
  | "DEPOSIT_CONFIRMED"
  | "DEPOSIT_REJECTED"
  | "STATUS"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED"
  | "REFUNDED"
  | "NOTE";

export interface WebOrderEvent {
  id: number;
  kind: WebOrderEventKind;
  /** "customer", "system", or a staff username. */
  actor: string;
  /** Shown to the customer on their tracking page. */
  public: boolean;
  message: string;
  data: Record<string, unknown>;
  at: string;
}

export interface WebOrderDetail extends WebOrder {
  deposit: WebOrder["deposit"] & { has_proof: boolean };
  items: WebOrderItem[];
  tracking_url: string;
  events: WebOrderEvent[];
  shortages: { product_id: number; name: string; needed: string; free: string; missing: boolean }[];
  /** Other orders that quoted the same transfer reference. */
  duplicate_reference: string[];
  history: { orders: number; completed: number; cancelled: number };
}

export interface WebOrderBoard {
  orders: WebOrder[];
  summary: {
    counts: Partial<Record<WebOrderStatus, number>>;
    orders_today: number;
    deposits_today: string;
    completed_today: number;
    sales_today: string;
    open_value: string;
    refunds_due: number;
    refunds_due_amount: string;
  };
  server_time: string;
}

export interface WebOrderPage {
  results: WebOrder[];
  count: number;
  page: number;
  pages: number;
}

export interface WebPriceChange {
  product_id: number;
  name: string;
  quantity: string;
  quoted_price: string;
  current_price: string;
  quoted_line: string;
  current_line: string;
}

/** What ringing a website order up would look like right now. */
export interface WebSalePlan {
  changes: WebPriceChange[];
  /** The goods at the prices chosen, before a game prize. */
  goods?: string;
  /** A game prize, rung up as the sale's own discount. */
  discount?: string;
  prize_code?: string;
  /** What the cashier sale comes to: the goods less the prize. */
  total: string;
  quoted_total: string;
  current_total: string;
  honoured_total: string;
  deposit_applied: string;
  balance: string;
  delivery_fee_due: string;
  to_collect: string;
}
