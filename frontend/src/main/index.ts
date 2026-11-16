import { app, BrowserWindow, ipcMain, Menu, safeStorage } from "electron";
import log from "electron-log/main";

import {
  buildDrawerKick,
  buildReceipt,
  sendToPrinter,
  type PrinterConfig,
  type ReceiptLine,
} from "./escpos";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

import {
  installDownloadedUpdate,
  runStartupUpdateGate,
  sendUpdateStatus,
  startSessionUpdates,
} from "./updater";
import { createMainWindow, createSplashWindow, loadPage, registerWindowIpc } from "./windows";

// userData follows the app's name, and it holds the offline sale queue, held
// sales, auth tokens and printer settings. Pin it to the folder the app has
// always used so a product rename can never strand sales banked offline.
// (Updater activity is logged to its logs\main.log.)
app.setPath("userData", join(app.getPath("appData"), "cashier-desktop"));

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

const authFile = () => join(app.getPath("userData"), "auth.bin");
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Splash, update gate, then the main window. */
async function start(): Promise<void> {
  splashWindow = createSplashWindow();
  await loadPage(splashWindow, "splash").catch((err) => log.warn("[app] splash failed to load:", err));
  if ((await runStartupUpdateGate(() => splashWindow)) === "installing") return;

  sendUpdateStatus(splashWindow, { state: "opening" });
  const win = await openMainWindow();
  // Only now: closing the splash while it is the last window would quit the app.
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
  splashWindow = null;
  startSessionUpdates(win);
}

async function openMainWindow(): Promise<BrowserWindow> {
  const win = createMainWindow();
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  const firstPaint = new Promise<void>((resolve) => win.once("ready-to-show", () => resolve()));
  await loadPage(win, "index").catch((err) => log.error("[app] main window failed to load:", err));
  // The first paint lands within moments of the load; never stay on the
  // splash if a graphics hiccup swallows the event.
  await Promise.race([firstPaint, sleep(3000)]);
  win.show();
  return win;
}

ipcMain.handle("app:version", () => app.getVersion());
ipcMain.handle("app:install-update", () => installDownloadedUpdate());
registerWindowIpc();

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
  if (config.transport === "none" || config.transport === "windows") {
    return { success: false, error: "No ESC/POS printer configured." };
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
  if (config.transport === "none" || config.transport === "windows") {
    return { success: false, error: "No ESC/POS printer configured." };
  }
  try {
    await sendToPrinter(buildDrawerKick(), config);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// --- Receipt printing: render HTML in a hidden window and print it ---
// With a printer name it goes straight to that Windows printer, silently;
// without one the print dialog opens. Never throws: the sale is already done.
ipcMain.handle("receipt:print", async (_e, html: string, printer?: string | null) => {
  // A file rather than a data: URL, which has a length limit.
  const file = join(tmpdir(), `cashier-receipt-${randomUUID()}.html`);
  const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    writeFileSync(file, html, "utf-8");
    await printWin.loadFile(file);
    return await new Promise<{ success: boolean; error?: string }>((resolve) => {
      printWin.webContents.print(
        {
          silent: Boolean(printer),
          deviceName: printer || undefined,
          printBackground: true,
          margins: { marginType: "none" },
        },
        // failureReason is "cancelled" when the dialog was closed.
        (success, failureReason) => resolve(success ? { success } : { success, error: failureReason })
      );
    });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    printWin.destroy();
    try {
      unlinkSync(file);
    } catch {
      /* the system cleans its temp folder */
    }
  }
});

// --- Barcode labels: drawn as a page and printed through the label printer's own driver ---
// The driver turns everything into graphics, so Arabic prints although the
// printer's built-in fonts are Latin only.
ipcMain.handle("labels:printers", async (event) => {
  const printers = await event.sender.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName || p.name,
    isDefault: p.isDefault,
  }));
});

interface LabelJob {
  html: string;
  /** Print straight to this printer; null shows the print dialog. */
  printer: string | null;
  widthMm: number;
  heightMm: number;
}

ipcMain.handle("labels:print", async (_e, job: LabelJob) => {
  // A file, not a data: URL: a long run of labels outgrows the URL length limit.
  const file = join(tmpdir(), `cashier-labels-${randomUUID()}.html`);
  writeFileSync(file, job.html, "utf-8");
  const printWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await printWin.loadFile(file);
    return await new Promise<{ success: boolean; error?: string }>((resolve) => {
      printWin.webContents.print(
        {
          silent: Boolean(job.printer),
          deviceName: job.printer ?? undefined,
          printBackground: true,
          margins: { marginType: "none" },
          // Microns. One page per label.
          pageSize: { width: Math.round(job.widthMm * 1000), height: Math.round(job.heightMm * 1000) },
        },
        (success, failureReason) => resolve(success ? { success } : { success, error: failureReason })
      );
    });
  } catch (err) {
    return { success: false, error: (err as Error).message };
  } finally {
    printWin.destroy();
    try {
      unlinkSync(file);
    } catch {
      /* the system cleans its temp folder */
    }
  }
});

// One instance only: launching again (say, while the update splash is up)
// brings the running window forward instead of opening a second till.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = [mainWindow, splashWindow].find((w) => w && !w.isDestroyed() && w.isVisible());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app
    .whenReady()
    .then(() => {
      // No File / Edit / View bar: the app draws its own title bar. macOS keeps
      // its menu, which is what makes copy and paste work there.
      if (process.platform !== "darwin") Menu.setApplicationMenu(null);
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) void openMainWindow();
      });
      return start();
    })
    .catch((err) => {
      log.error("[app] startup failed:", err);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
