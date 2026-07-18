import { app, shell, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

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
    title: "Cashier POS",
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
