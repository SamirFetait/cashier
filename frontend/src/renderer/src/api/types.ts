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
  is_active: boolean;
  quantity_in_storage: number;
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

export interface OrderItem {
  id: number;
  product: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface Order {
  id: number;
  customer: number | null;
  customer_name: string | null;
  storage: number;
  created_by: number | null;
  created_by_username: string | null;
  status: string;
  payment_method: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  items: OrderItem[];
  created_at: string;
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
