// Bridges Electron's preload `window.api` with browser fallbacks so the
// renderer also runs in a normal browser tab (useful for quick UI testing).

export interface Tokens {
  access: string;
  refresh: string;
}

const hasElectron = typeof window !== "undefined" && !!window.api;
const TOKEN_KEY = "cashier.tokens";

export const platform = {
  isElectron: hasElectron,

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
