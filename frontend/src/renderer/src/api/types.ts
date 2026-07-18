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
  connected: boolean;
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
