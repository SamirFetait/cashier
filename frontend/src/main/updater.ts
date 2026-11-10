/**
 * Auto-update from GitHub releases (electron-updater; see RELEASE.md).
 *
 * At launch the update gate runs before the app opens: a newer published
 * release is downloaded behind the splash and installed, so no till keeps
 * working on an outdated build. A till left open is checked again every few
 * hours; that update downloads in the background and the app offers a restart.
 */
import { app, type BrowserWindow } from "electron";
import log from "electron-log/main";
import { autoUpdater, type ProgressInfo } from "electron-updater";

import type { UpdateStatus } from "../shared/updates";

// Being offline or rate-limited must never lock the till: past these limits
// the app opens on the current version and tries again at the next check.
const CHECK_TIMEOUT_MS = 15_000; // no answer from GitHub
const STALL_TIMEOUT_MS = 90_000; // the download made no progress for this long
// A till that stays open for days never passes the startup gate again.
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function sendUpdateStatus(win: BrowserWindow | null, status: UpdateStatus): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("update-status", status);
  } catch {
    /* the window is closing */
  }
}

let configured = false;

function configure(): void {
  if (configured) return;
  configured = true;
  autoUpdater.logger = log;
  // Delta updates: only the installer blocks that changed are downloaded,
  // using the .blockmap published beside each installer. electron-updater
  // falls back to the full installer by itself when that is not possible.
  autoUpdater.disableDifferentialDownload = false;
  autoUpdater.disableWebInstaller = true;
  // "Later" still installs a downloaded update on the next quit.
  autoUpdater.autoInstallOnAppQuit = true;
  // An "error" event with no listener throws and would take the app down.
  // Kept for the app's lifetime: a check that timed out at startup can still
  // fail after the app has opened.
  autoUpdater.on("error", (err) =>
    log.warn("[updater] error:", err == null ? "unknown" : err.stack || err.message || err)
  );
}

/**
 * Startup gate. Resolves "continue" when the app is up to date or the check
 * failed, timed out or stalled, and "installing" once the installer has been
 * started (the app is quitting). Installed builds only: a dev run has no
 * app-update.yml to check against.
 */
export async function runStartupUpdateGate(
  splash: () => BrowserWindow | null
): Promise<"continue" | "installing"> {
  if (!app.isPackaged) return "continue";
  configure();
  autoUpdater.autoDownload = false;

  const status = (s: UpdateStatus) => sendUpdateStatus(splash(), s);
  let onProgress: ((progress: ProgressInfo) => void) | null = null;

  try {
    status({ state: "checking" });
    const check = await Promise.race([
      autoUpdater.checkForUpdates(),
      sleep(CHECK_TIMEOUT_MS).then(() => "timeout" as const),
    ]);
    if (check === "timeout") {
      log.warn("[updater] startup check timed out; opening the app.");
      return "continue";
    }
    if (!check || !check.isUpdateAvailable) return "continue";

    const version = check.updateInfo.version;
    log.info(`[updater] startup: downloading ${version}`);
    status({ state: "downloading", version, percent: 0 });

    let lastProgressAt = Date.now();
    onProgress = (progress) => {
      lastProgressAt = Date.now();
      status({
        state: "downloading",
        version,
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
      });
    };
    autoUpdater.on("download-progress", onProgress);

    let stallTimer: ReturnType<typeof setInterval> | undefined;
    const stalled = new Promise<"stalled">((resolve) => {
      stallTimer = setInterval(() => {
        if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) resolve("stalled");
      }, 5000);
    });
    let outcome: "downloaded" | "stalled";
    try {
      outcome = await Promise.race([
        autoUpdater.downloadUpdate().then(() => "downloaded" as const),
        stalled,
      ]);
    } finally {
      clearInterval(stallTimer);
    }
    if (outcome === "stalled") {
      // The download carries on in the background; once done it installs on
      // quit, or the running app offers a restart.
      log.warn("[updater] startup download stalled; opening the app.");
      status({ state: "error" });
      await sleep(2500);
      return "continue";
    }

    status({ state: "installing", version });
    await sleep(1200);
    // Not silent: the one-click installer shows its own progress, then
    // relaunches the new version.
    autoUpdater.quitAndInstall(false, true);
    return "installing";
  } catch (err) {
    log.warn("[updater] startup update failed; opening the app:", err);
    const win = splash();
    if (win && !win.isDestroyed() && win.isVisible()) {
      status({ state: "error" });
      await sleep(2500);
    }
    return "continue";
  } finally {
    if (onProgress) autoUpdater.removeListener("download-progress", onProgress);
  }
}

let sessionStarted = false;
let downloadedVersion: string | null = null;

/**
 * Background updates for an app that stays open. The startup gate has just
 * checked, so the first check here waits one interval. Updater errors are
 * logged and otherwise ignored: being offline must never stop a sale.
 */
export function startSessionUpdates(win: BrowserWindow): void {
  if (!app.isPackaged || sessionStarted) return;
  sessionStarted = true;
  configure();
  autoUpdater.autoDownload = true;

  const send = (s: UpdateStatus) => sendUpdateStatus(win, s);
  autoUpdater.on("checking-for-update", () => send({ state: "checking" }));
  autoUpdater.on("update-available", (info) => send({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => send({ state: "none" }));
  autoUpdater.on("download-progress", (p) => send({ state: "downloading", percent: p.percent }));
  autoUpdater.on("error", () => send({ state: "error" })); // logged in configure()
  autoUpdater.on("update-downloaded", (info) => {
    downloadedVersion = info.version;
    send({ state: "downloaded", version: info.version });
  });

  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => log.warn("[updater] check failed:", err));
  }, RECHECK_INTERVAL_MS);
}

/** "Restart now": quit and run the installer of the update already downloaded. */
export function installDownloadedUpdate(): void {
  if (!downloadedVersion) return;
  log.info(`[updater] installing ${downloadedVersion} on request`);
  autoUpdater.quitAndInstall();
}
