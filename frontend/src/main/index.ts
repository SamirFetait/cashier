import { app, shell, BrowserWindow, ipcMain, safeStorage } from "electron";

import {
  buildDrawerKick,
  buildReceipt,
  sendToPrinter,
  type PrinterConfig,
  type ReceiptLine,
} from "./escpos";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

import iconIco from "../../build/icon.ico?asset";
import iconPng from "../../build/icon.png?asset";

// userData follows the app's name, and it holds the offline sale queue, held
// sales, auth tokens and printer settings. Pin it to the folder the app has
// always used so a product rename can never strand sales banked offline.
app.setPath("userData", join(app.getPath("appData"), "cashier-desktop"));

let mainWindow: BrowserWindow | null = null;

const authFile = () => join(app.getPath("userData"), "auth.bin");

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    title: "Fathet Kheer POS",
    // The .ico carries hand-picked 16-48px frames for the title bar and
    // taskbar; macOS ignores this and uses the bundle icon.
    icon: process.platform === "win32" ? iconIco : iconPng,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  // electron-vite injects ELECTRON_RENDERER_URL in dev; load the built file otherwise.
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// --- Encrypted token storage (refresh + access tokens) ---
ipcMain.handle("auth:get", () => {
  try {
    if (!existsSync(authFile())) return null;
    const buf = readFileSync(authFile());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString("utf-8");
    return JSON.parse(json);
  } catch {
    return null;
  }
});

ipcMain.handle("auth:set", (_e, tokens: unknown) => {
  const json = JSON.stringify(tokens);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, "utf-8");
  writeFileSync(authFile(), data);
  return true;
});

ipcMain.handle("auth:clear", () => {
  try {
    if (existsSync(authFile())) unlinkSync(authFile());
  } catch {
    /* ignore */
  }
  return true;
});

// --- Thermal printer configuration ---
// Stored beside the auth file so a terminal keeps its own printer settings.
function printerFile() {
  return join(app.getPath("userData"), "printer.json");
}

function loadPrinterConfig(): PrinterConfig {
  try {
    if (existsSync(printerFile())) {
      return JSON.parse(readFileSync(printerFile(), "utf-8"));
    }
  } catch {
    /* fall through to defaults */
  }
  // Env vars let a fleet be provisioned without touching each machine.
  const host = process.env.PRINTER_HOST;
  if (host) {
    return {
      transport: "network",
      host,
      port: Number(process.env.PRINTER_PORT || 9100),
      width: Number(process.env.PRINTER_WIDTH || 42),
    };
  }
  return { transport: "none" };
}

ipcMain.handle("printer:get", () => loadPrinterConfig());

ipcMain.handle("printer:set", (_e, config: PrinterConfig) => {
  writeFileSync(printerFile(), JSON.stringify(config, null, 2), "utf-8");
  return true;
});

ipcMain.handle("printer:escpos", async (_e, lines: ReceiptLine[]) => {
  const config = loadPrinterConfig();
  if (config.transport === "none") {
    return { success: false, error: "No thermal printer configured." };
  }
  try {
    await sendToPrinter(buildReceipt(lines, config), config);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle("printer:kick", async () => {
  const config = loadPrinterConfig();
  if (config.transport === "none") {
    return { success: false, error: "No thermal printer configured." };
  }
  try {
    await sendToPrinter(buildDrawerKick(), config);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// --- Receipt printing: render HTML in a hidden window and open the print dialog ---
ipcMain.handle("receipt:print", async (_e, html: string) => {
  const printWin = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true },
  });
  await printWin.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(html)
  );
  return new Promise<{ success: boolean }>((resolve) => {
    printWin.webContents.print(
      { silent: false, printBackground: true, margins: { marginType: "none" } },
      (success) => {
        printWin.close();
        resolve({ success });
      }
    );
  });
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
