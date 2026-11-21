/**
 * The website's catalogue, content and settings, managed from the cashier.
 *
 * The same server API the orders admin web app uses (/api/shop/admin/…),
 * signed in with the cashier's own token. Anyone signed in may read it;
 * changes need a super admin, which the server enforces.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../api/client";
import type { SoldBy } from "../api/types";
import type { Lang, Messages } from "../i18n";
import { shopError } from "../webOrders/api";

const A = "/shop/admin";

export const websiteKeys = {
  listings: ["website", "listings"] as const,
  settings: ["website", "settings"] as const,
  health: ["website", "health"] as const,
  videos: ["website", "videos"] as const,
  events: ["website", "events"] as const,
  swaps: ["website", "swaps"] as const,
};

// --- Types --------------------------------------------------------------------

export const NUTRIENTS = ["kcal", "protein", "carbs", "sugar", "fat", "fiber"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];

/** An active product as the website presents it. Figures are per 100 g. */
export interface ListingRow extends Record<Nutrient, string | null> {
  id: number;
  name: string;
  category: string;
  price: string;
  unit: string;
  sold_by: SoldBy;
  stock: string;
  /** Held by open website orders. */
  reserved: string;
  thumb: string | null;
  hidden: boolean;
  featured: boolean;
  badge: string;
  description: string;
  /** One piece's weight in grams, for products sold by the piece. */
  piece_grams: string | null;
}

export type ListingInput = Partial<
  Pick<ListingRow, "hidden" | "featured" | "badge" | "description" | Nutrient | "piece_grams">
>;

export interface WebsiteSettings {
  ordering_enabled: boolean;
  instapay_address: string;
  instapay_name: string;
  instapay_mobile: string;
  instapay_link: string;
  instapay_qr_image: string | null;
  instapay_ready: boolean;
  deposit_percent: number;
  deposit_min: string;
  hold_minutes: number;
  delivery_enabled: boolean;
  pickup_enabled: boolean;
  delivery_fee: string;
  free_delivery_over: string | null;
  min_order: string;
  whatsapp: string;
  whatsapp_alerts: boolean;
  /** Where order alerts go; empty means the store's WhatsApp number. */
  alert_whatsapp: string;
  address_ar: string;
  address_en: string;
  hours_ar: string;
  hours_en: string;
  delivery_note_ar: string;
  delivery_note_en: string;
  announcement_ar: string;
  announcement_en: string;
  /** The website's games, each switched on or off. */
  push_ups_on: boolean;
  memory_on: boolean;
  calorie_challenge_on: boolean;
  hungry_bee_on: boolean;
  /** Whether a good score wins a share off the next web order, and on what terms. */
  prizes_enabled: boolean;
  prize_percent: number;
  prize_max: string;
  prize_min_order: string;
  /** The score that wins in each game. */
  push_ups_to_win: number;
  memory_stars_to_win: number;
  quiz_to_win: number;
  hungry_bee_to_win: number;
  updated_at: string | null;
  updated_by: string;
}

export interface WebsiteHealth {
  storage: { ok: boolean; name: string };
  products: number;
  instapay_ready: boolean;
  ordering_enabled: boolean;
  site_url: string;
  /** Whether order alerts can reach the shop's WhatsApp. Numbers are digits. */
  whatsapp?: {
    alerts: boolean;
    /** Meta's Cloud API, or the sidecar's linked account (older servers say nothing). */
    provider?: "cloud" | "sidecar";
    to: string;
    connected: boolean;
    from: string;
    /** The paired account would message itself: no phone rings. */
    same_number: boolean;
    error: string;
  };
}

export interface WebsiteVideo {
  id: number;
  placement: "HERO" | "STORY";
  title: string;
  caption: string;
  src: string;
  poster: string | null;
  content_type: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  product_id: number | null;
  is_active: boolean;
  sort: number;
  size: number;
  created_at: string;
  created_by: string;
}

export interface EventMediaItem {
  id: number;
  kind: "PHOTO" | "VIDEO";
  src: string;
  poster: string | null;
  content_type: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  size: number;
  sort: number;
}

export interface WebsiteEvent {
  id: number;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string | null;
  /** Empty: at the shop. */
  place: string;
  /** The first photo, else the first video's still frame. */
  cover: string | null;
  media: EventMediaItem[];
  is_published: boolean;
  created_by: string;
  created_at: string;
}

export interface EventInput {
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string | null;
  place?: string;
  is_published?: boolean;
}

export interface WebsiteSwap {
  id: number;
  craving: string;
  emoji: string;
  reason: string;
  sort: number;
  is_active: boolean;
  products: Array<{ id: number; name: string; is_active: boolean; thumb: string | null }>;
}

export interface SwapInput {
  craving?: string;
  emoji?: string;
  reason?: string;
  product_ids?: number[];
  sort?: number;
  is_active?: boolean;
}

// --- Catalogue ----------------------------------------------------------------

export function useListings() {
  return useQuery({
    queryKey: websiteKeys.listings,
    queryFn: async () => (await api.get<{ products: ListingRow[] }>(`${A}/listings/`)).data.products,
    staleTime: 15_000,
  });
}

export function useSaveListing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: ListingInput }) =>
      (await api.put<{ product: ListingRow }>(`${A}/listings/${id}/`, body)).data.product,
    onSuccess: (row) =>
      client.setQueryData<ListingRow[]>(websiteKeys.listings, (rows) =>
        rows?.map((current) => (current.id === row.id ? row : current))
      ),
  });
}

// --- Settings -----------------------------------------------------------------

export function useWebsiteSettings() {
  return useQuery({
    queryKey: websiteKeys.settings,
    queryFn: async () => (await api.get<{ settings: WebsiteSettings }>(`${A}/settings/`)).data.settings,
  });
}

export function useSaveWebsiteSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<WebsiteSettings>) =>
      (await api.put<{ settings: WebsiteSettings }>(`${A}/settings/`, body)).data.settings,
    onSuccess: (settings) => {
      client.setQueryData(websiteKeys.settings, settings);
      void client.invalidateQueries({ queryKey: websiteKeys.health });
    },
  });
}

/** The InstaPay QR picture: a file uploads it, null removes it. */
export function useQrUpload() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (file: File | null) => {
      if (file === null) {
        return (await api.delete<{ settings: WebsiteSettings }>(`${A}/settings/instapay-qr/`)).data.settings;
      }
      const form = new FormData();
      form.set("image", file);
      return (await api.post<{ settings: WebsiteSettings }>(`${A}/settings/instapay-qr/`, form)).data.settings;
    },
    onSuccess: (settings) => client.setQueryData(websiteKeys.settings, settings),
  });
}

/** The setup as the server sees it. Its WhatsApp check can take a few
 * seconds when the service is down, so it is reused for a minute. */
export function useWebsiteHealth() {
  return useQuery({
    queryKey: websiteKeys.health,
    queryFn: async () => (await api.get<WebsiteHealth>(`${A}/health/`)).data,
    staleTime: 60_000,
  });
}

// --- Videos, events, swaps ----------------------------------------------------

export function useVideos() {
  return useQuery({
    queryKey: websiteKeys.videos,
    queryFn: async () => (await api.get<{ videos: WebsiteVideo[]; max_mb: number }>(`${A}/videos/`)).data,
  });
}

export function useVideoMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: websiteKeys.videos });
  return {
    upload: useMutation({
      mutationFn: async ({ form, onProgress }: { form: FormData; onProgress?: (share: number) => void }) =>
        (
          await api.post<{ video: WebsiteVideo }>(`${A}/videos/`, form, {
            onUploadProgress: (event) => event.total && onProgress?.(event.loaded / event.total),
          })
        ).data.video,
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: Partial<WebsiteVideo> }) =>
        (await api.patch<{ video: WebsiteVideo }>(`${A}/videos/${id}/`, body)).data.video,
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => api.delete(`${A}/videos/${id}/`),
      onSuccess: refresh,
    }),
  };
}

export function useEvents() {
  return useQuery({
    queryKey: websiteKeys.events,
    queryFn: async () => (await api.get<{ events: WebsiteEvent[]; max_mb: number }>(`${A}/events/`)).data,
  });
}

/** Every change answers with the event as it now stands; the list refreshes. */
export function useEventMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: websiteKeys.events });
  const event = (data: { event: WebsiteEvent }) => data.event;
  return {
    create: useMutation({
      mutationFn: async (body: EventInput) => event((await api.post(`${A}/events/`, body)).data),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: EventInput }) =>
        event((await api.patch(`${A}/events/${id}/`, body)).data),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => api.delete(`${A}/events/${id}/`),
      onSuccess: refresh,
    }),
    addMedia: useMutation({
      mutationFn: async ({ id, form }: { id: number; form: FormData }) =>
        event((await api.post(`${A}/events/${id}/media/`, form)).data),
      onSuccess: refresh,
    }),
    reorder: useMutation({
      mutationFn: async ({ id, ids }: { id: number; ids: number[] }) =>
        event((await api.post(`${A}/events/${id}/media/order/`, { ids })).data),
      onSuccess: refresh,
    }),
    removeMedia: useMutation({
      mutationFn: async ({ id, mediaId }: { id: number; mediaId: number }) =>
        event((await api.delete(`${A}/events/${id}/media/${mediaId}/`)).data),
      onSuccess: refresh,
    }),
  };
}

export function useSwaps() {
  return useQuery({
    queryKey: websiteKeys.swaps,
    queryFn: async () => (await api.get<{ swaps: WebsiteSwap[] }>(`${A}/swaps/`)).data.swaps,
  });
}

export function useSwapMutations() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: websiteKeys.swaps });
  return {
    save: useMutation({
      mutationFn: async ({ id, body }: { id: number | null; body: SwapInput }) =>
        id === null ? api.post(`${A}/swaps/`, body) : api.patch(`${A}/swaps/${id}/`, body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: number) => api.delete(`${A}/swaps/${id}/`),
      onSuccess: refresh,
    }),
  };
}

// --- Links to the website -----------------------------------------------------

/** Where customers reach the website (from the server), or null until known. */
export function useSiteUrl(): string | null {
  const health = useWebsiteHealth();
  const url = health.data?.site_url?.replace(/\/+$/, "");
  return url || null;
}

export type SitePage =
  | { kind: "home" }
  | { kind: "product"; id: number }
  | { kind: "category"; id: number }
  | { kind: "section"; path: "/events" | "/videos" | "/health" };

/** A page's address on the website: Arabic at the root, English under /en,
 * as the website itself builds them. */
export function siteLink(site: string, page: SitePage, lang: Lang): string {
  const path =
    page.kind === "product"
      ? `/product/${page.id}/`
      : page.kind === "category"
        ? `/category/${page.id}/`
        : page.kind === "section"
          ? page.path
          : "/";
  return `${site}${lang === "en" ? `/en${path}` : path}`;
}

// --- Errors and formatting ----------------------------------------------------

/** What to tell staff when a website request fails. */
export function websiteErrorText(error: unknown, t: Messages): string {
  const body = shopError(error);
  if (!body) return t.common.failed;
  return t.webOrders.errors[body.code] ?? (body.detail || t.common.failed);
}

/** The server's per-field complaints about a form ({title: "…"}), if any. */
export function fieldErrors(error: unknown): Record<string, string> {
  const fields = shopError(error)?.fields;
  if (!fields || typeof fields !== "object") return {};
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? String(value[0]) : String(value),
    ])
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "1:05" */
export function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface VideoMeta {
  duration: number | null;
  width: number | null;
  height: number | null;
  poster: Blob | null;
}

/** Reads a chosen video here: its length and size, and a frame to use as
 * the poster, so the server never has to decode video. Null when this
 * computer cannot open the file. */
export function readVideo(file: File): Promise<VideoMeta | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    let settled = false;
    const finish = (meta: VideoMeta | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = window.setTimeout(() => finish(null), 15000);
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(1, (video.duration || 2) / 3);
    };
    video.onseeked = () => {
      window.clearTimeout(timer);
      const width = video.videoWidth;
      const height = video.videoHeight;
      const base = {
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: width || null,
        height: height || null,
      };
      if (!width || !height) return finish({ ...base, poster: null });
      const scale = Math.min(1, 1280 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => finish({ ...base, poster: blob }), "image/jpeg", 0.82);
    };
    video.src = url;
  });
}
