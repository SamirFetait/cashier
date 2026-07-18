import { contextBridge, ipcRenderer } from "electron";

const api = {
  auth: {
    get: (): Promise<unknown> => ipcRenderer.invoke("auth:get"),
    set: (tokens: unknown): Promise<boolean> => ipcRenderer.invoke("auth:set", tokens),
    clear: (): Promise<boolean> => ipcRenderer.invoke("auth:clear"),
  },
  printReceipt: (html: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("receipt:print", html),
  printer: {
    get: (): Promise<unknown> => ipcRenderer.invoke("printer:get"),
    set: (config: unknown): Promise<boolean> =>
      ipcRenderer.invoke("printer:set", config),
    escpos: (lines: unknown): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("printer:escpos", lines),
    kick: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke("printer:kick"),
  },
  isElectron: true,
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
