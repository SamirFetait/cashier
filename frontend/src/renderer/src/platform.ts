// Bridges Electron's preload `window.api` with browser fallbacks so the
// renderer also runs in a normal browser tab (useful for quick UI testing).

import type { TitleBarColors } from "../../shared/titlebar";
import type { UpdateStatus } from "../../shared/updates";

export interface Tokens {
  access: string;
  refresh: string;
}

const hasElectron = typeof window !== "undefined" && !!window.api;
const TOKEN_KEY = "cashier.tokens";

export const platform = {
  isElectron: hasElectron,

  /** The window has no system title bar, so the app draws its own (Windows). */
  hasCustomTitleBar: hasElectron && !!window.api!.window?.hasCustomTitleBar,

  setTitleBarColors(colors: TitleBarColors): void {
    if (hasElectron) window.api!.window?.setTitleBarColors(colors);
  },

  async appVersion(): Promise<string | null> {
    if (!hasElectron || !window.api!.app) return null;
    return window.api!.app.version();
  },

  /** Update progress from the main process; returns an unsubscribe function. */
  onUpdateStatus(handler: (status: UpdateStatus) => void): () => void {
    if (!hasElectron || !window.api!.app) return () => {};
    return window.api!.app.onUpdateStatus(handler);
  },

  async installUpdate(): Promise<void> {
    if (hasElectron && window.api!.app) await window.api!.app.installUpdate();
  },

  async getTokens(): Promise<Tokens | null> {
    if (hasElectron) return (await window.api!.auth.get()) as Tokens | null;
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  },

  async setTokens(tokens: Tokens): Promise<void> {
    if (hasElectron) {
      await window.api!.auth.set(tokens);
    } else {
      localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
    }
  },

  async clearTokens(): Promise<void> {
    if (hasElectron) {
      await window.api!.auth.clear();
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  /** ESC/POS thermal print. Reports failure rather than throwing so callers
   *  can fall back to the HTML dialog. */
  async printEscPos(lines: unknown): Promise<{ success: boolean; error?: string }> {
    if (!hasElectron || !window.api!.printer) {
      return { success: false, error: "Not running in Electron." };
    }
    try {
      return await window.api!.printer.escpos(lines);
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async openCashDrawer(): Promise<{ success: boolean; error?: string }> {
    if (!hasElectron || !window.api!.printer) {
      return { success: false, error: "Not running in Electron." };
    }
    try {
      return await window.api!.printer.kick();
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },

  async getPrinterConfig(): Promise<unknown> {
    if (!hasElectron || !window.api!.printer) return { transport: "none" };
    return window.api!.printer.get();
  },

  async setPrinterConfig(config: unknown): Promise<boolean> {
    if (!hasElectron || !window.api!.printer) return false;
    return window.api!.printer.set(config);
  },

  async printReceipt(html: string): Promise<void> {
    if (hasElectron) {
      await window.api!.printReceipt(html);
      return;
    }
    const w = window.open("", "_blank", "width=380,height=600");
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    }
  },
};
