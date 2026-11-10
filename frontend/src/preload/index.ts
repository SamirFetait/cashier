import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { TitleBarColors } from "../shared/titlebar";
import type { UpdateStatus } from "../shared/updates";

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
  app: {
    /** The running build's version, e.g. "1.0.3". */
    version: (): Promise<string> => ipcRenderer.invoke("app:version"),
    /** Quit and install the update that has finished downloading. */
    installUpdate: (): Promise<void> => ipcRenderer.invoke("app:install-update"),
    /** Update progress from the main process. Returns an unsubscribe function. */
    onUpdateStatus: (handler: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus) => handler(status);
      ipcRenderer.on("update-status", listener);
      return () => ipcRenderer.removeListener("update-status", listener);
    },
  },
  window: {
    /** On Windows the page draws the title bar; Windows only draws the buttons. */
    hasCustomTitleBar: process.platform === "win32",
    setTitleBarColors: (colors: TitleBarColors): void =>
      ipcRenderer.send("window:titlebar-colors", colors),
  },
  isElectron: true,
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
