/**
 * Website orders, read and worked from the cashier app.
 *
 * The same server API the orders admin web app uses (/api/shop/admin/…),
 * signed in with the cashier's own token. One board query is shared by the
 * Website Orders page and the alerts that run on every screen, so the app
 * polls the server once however many places show it.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "../api/client";
import type {
  SoldBy,
  WebOrderBoard,
  WebOrderDetail,
  WebOrderPage,
  WebOrderStatus,
  WebSalePlan,
} from "../api/types";
import type { Messages } from "../i18n";

const BOARD_POLL_MS = 15_000;

export const webOrderKeys = {
  all: ["web-orders"] as const,
  board: ["web-orders", "board"] as const,
  detail: (id: number) => ["web-orders", "detail", id] as const,
  list: (q: string, status: string, page: number) => ["web-orders", "list", q, status, page] as const,
  plan: (id: number, mode: PriceMode | null) => ["web-orders", "plan", id, mode] as const,
};

/** Every open order, refreshed every 15 seconds, including while the window
 * is minimised: that is when the alerts matter most. */
export function useBoard() {
  return useQuery({
    queryKey: webOrderKeys.board,
    queryFn: async () => (await api.get<WebOrderBoard>("/shop/admin/board/")).data,
    refetchInterval: BOARD_POLL_MS,
    refetchIntervalInBackground: true,
  });
}

export function useOrderDetail(id: number | null) {
  return useQuery({
    queryKey: webOrderKeys.detail(id ?? 0),
    queryFn: async () =>
      (await api.get<{ order: WebOrderDetail }>(`/shop/admin/orders/${id}/`)).data.order,
    enabled: id !== null,
    refetchInterval: BOARD_POLL_MS,
  });
}

export function useOrderSearch(q: string, status: string, page: number) {
  return useQuery({
    queryKey: webOrderKeys.list(q, status, page),
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      if (status) params.set("status", status);
      return (await api.get<WebOrderPage>(`/shop/admin/orders/?${params}`)).data;
    },
    placeholderData: keepPreviousData,
  });
}

export type PriceMode = "quoted" | "current";

export function useSalePlan(id: number, mode: PriceMode | null, enabled: boolean) {
  return useQuery({
    queryKey: webOrderKeys.plan(id, mode),
    queryFn: async () =>
      (
        await api.get<WebSalePlan>(
          `/shop/admin/orders/${id}/sale-plan/${mode ? `?price_mode=${mode}` : ""}`
        )
      ).data,
    enabled,
    staleTime: 0,
  });
}

export type OrderAction =
  | "confirm-deposit"
  | "reject-deposit"
  | "status"
  | "cancel"
  | "refund"
  | "note"
  | "complete";

/** Any step on an order. The answer is the order as it now stands. */
export function useOrderAction(id: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, body }: { action: OrderAction; body?: Record<string, unknown> }) =>
      (await api.post<{ order: WebOrderDetail }>(`/shop/admin/orders/${id}/${action}/`, body ?? {}))
        .data.order,
    onSuccess: (order) => {
      client.setQueryData(webOrderKeys.detail(id), order);
      void client.invalidateQueries({ queryKey: webOrderKeys.board });
      void client.invalidateQueries({ queryKey: ["web-orders", "list"] });
    },
    onError: (error) => {
      // Someone else moved the order on meanwhile: show it as it is now.
      if (shopError(error)?.code === "INVALID_STATE") {
        void client.invalidateQueries({ queryKey: webOrderKeys.detail(id) });
        void client.invalidateQueries({ queryKey: webOrderKeys.board });
      }
    },
  });
}

// --- Errors -------------------------------------------------------------------

export interface ShopErrorBody {
  code: string;
  detail: string;
  [extra: string]: unknown;
}

/** The website API's error body ({code, detail, …}), if this is one. */
export function shopError(error: unknown): ShopErrorBody | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data && typeof data === "object" && typeof (data as ShopErrorBody).code === "string") {
    return data as ShopErrorBody;
  }
  return null;
}

/** What to tell staff when a step fails. The cashier's own refusals (no open
 * shift, not enough stock) come through in the server's words. */
export function errorText(error: unknown, t: Messages): string {
  const body = shopError(error);
  if (!body) return t.webOrders.loadFailed;
  return t.webOrders.errors[body.code] ?? (body.detail || t.common.failed);
}

// --- Formatting ---------------------------------------------------------------

export function money(value: string | number | null | undefined, t: Messages): string {
  return `${Number(value ?? 0).toFixed(2)} ${t.labels.currency}`;
}

export function toNumber(value: string | number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** "2", "0.25 kg": quantities as people say them. */
export function quantityText(qty: string, soldBy: SoldBy, unit: string): string {
  const plain = String(parseFloat(qty));
  return soldBy === "WEIGHT" ? `${plain} ${unit}` : plain;
}

/** wa.me wants the number as digits, country code first. */
export function whatsappLink(digits: string, text = ""): string {
  const query = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits.replace(/\D/g, "")}${query}`;
}

/** Picture paths come as "/api/…" on the server the app talks to. */
export function serverUrl(path: string): string {
  return new URL(path, api.defaults.baseURL).href;
}

/** Orders that need someone at the store to act. */
export function needsStaff(status: WebOrderStatus): boolean {
  return status === "DEPOSIT_REVIEW" || status === "CONFIRMED";
}

/** Re-renders on a timer, for countdowns and "5 min ago". */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** "3 min ago", "2 h ago", in the interface language. */
export function timeAgo(iso: string, now: number, lang: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(lang === "ar" ? "ar-EG-u-nu-latn" : "en", {
    numeric: "auto",
    style: "short",
  });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(Math.round(seconds), "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86400), "day");
}

/** "12:05" or "1:02:05", for a hold that is running out. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
