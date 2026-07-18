import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

import { platform } from "../platform";

const baseURL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";

export const api = axios.create({ baseURL });

let accessToken: string | null = null;
let onLogout: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function registerLogoutHandler(fn: () => void) {
  onLogout = fn;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const tokens = await platform.getTokens();
  if (!tokens?.refresh) return null;
  try {
    const resp = await axios.post(`${baseURL}/auth/refresh/`, {
      refresh: tokens.refresh,
    });
    const newAccess: string = resp.data.access;
    const newRefresh: string = resp.data.refresh || tokens.refresh;
    accessToken = newAccess;
    await platform.setTokens({ access: newAccess, refresh: newRefresh });
    return newAccess;
  } catch {
    return null;
  }
}

api.interceptors.response.use(
  (resp) => resp,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };
    const isAuthCall = original?.url?.includes("/auth/");
    if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
      original._retry = true;
      if (!refreshing) refreshing = refreshAccessToken();
      const token = await refreshing;
      refreshing = null;
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
      await platform.clearTokens();
      onLogout?.();
    }
    return Promise.reject(error);
  }
);
