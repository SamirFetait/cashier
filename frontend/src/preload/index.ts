import { contextBridge, ipcRenderer } from "electron";

const api = {
  auth: {
    get: (): Promise<unknown> => ipcRenderer.invoke("auth:get"),
    set: (tokens: unknown): Promise<boolean> => ipcRenderer.invoke("auth:set", tokens),
    clear: (): Promise<boolean> => ipcRenderer.invoke("auth:clear"),
  },
  printReceipt: (html: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("receipt:print", html),
  isElectron: true,
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
