/**
 * The app's windows. On Windows neither has the system title bar or menu:
 * the splash is frameless, and the main window shows the renderer's own title
 * bar with only the native minimize / maximize / close buttons drawn over it.
 */
import { BrowserWindow, ipcMain, shell } from "electron";
import { join } from "path";

import iconIco from "../../build/icon.ico?asset";
import iconPng from "../../build/icon.png?asset";
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from "../shared/titlebar";

const isWindows = process.platform === "win32";
// The .ico carries hand-picked 16-48px frames for the title bar and taskbar;
// macOS ignores this and uses the bundle icon.
const icon = isWindows ? iconIco : iconPng;

const webPreferences = {
  preload: join(__dirname, "../preload/index.js"),
  sandbox: false,
  contextIsolation: true,
};

/** A renderer page: from the dev server in development, the built files otherwise. */
export function loadPage(win: BrowserWindow, page: "index" | "splash"): Promise<void> {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) return win.loadURL(page === "index" ? devUrl : `${devUrl}/${page}.html`);
  return win.loadFile(join(__dirname, `../renderer/${page}.html`));
}

/** Shown the moment the app starts, until the main window is ready (renderer/splash.html). */
export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 460,
    height: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    title: "Fathet Kheer POS",
    backgroundColor: "#04332f", // the splash's own background, so it never flashes white
    icon,
    webPreferences,
  });
  win.once("ready-to-show", () => !win.isDestroyed() && win.show());
  return win;
}

/** Created hidden; shown once its first paint is ready. */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "Fathet Kheer POS",
    icon,
    ...(isWindows
      ? {
          titleBarStyle: "hidden" as const,
          // Matches the renderer's title bar; it re-sends colours per scheme.
          titleBarOverlay: { ...TITLEBAR_COLORS.light, height: TITLEBAR_HEIGHT },
        }
      : { autoHideMenuBar: true }),
    webPreferences,
  });

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  wireShortcuts(win);
  return win;
}

/**
 * The shortcuts the stock menu provided, which the custom title bar replaces.
 * Copy, paste and undo need no menu on Windows.
 */
function wireShortcuts(win: BrowserWindow): void {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    const contents = win.webContents;
    if (key === "f5" || (ctrl && !input.shift && key === "r")) contents.reload();
    else if (key === "f12" || (ctrl && input.shift && key === "i")) contents.toggleDevTools();
    else if (key === "f11") win.setFullScreen(!win.isFullScreen());
    else if (ctrl && (key === "=" || key === "+")) contents.setZoomLevel(Math.min(contents.getZoomLevel() + 0.5, 3));
    else if (ctrl && key === "-") contents.setZoomLevel(Math.max(contents.getZoomLevel() - 0.5, -3));
    else if (ctrl && key === "0") contents.setZoomLevel(0);
    else return;
    event.preventDefault();
  });
}

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/** The renderer sends its title-bar colours when the scheme changes, so the native buttons match. */
export function registerWindowIpc(): void {
  ipcMain.on("window:titlebar-colors", (event, colors: { color?: unknown; symbolColor?: unknown }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const color = typeof colors?.color === "string" ? colors.color.trim() : "";
    const symbolColor = typeof colors?.symbolColor === "string" ? colors.symbolColor.trim() : "";
    if (!win || win.isDestroyed() || !HEX_COLOR.test(color) || !HEX_COLOR.test(symbolColor)) return;
    try {
      win.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
    } catch {
      /* a window without a title-bar overlay (the splash, or not Windows) */
    }
  });
}
