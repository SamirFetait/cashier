require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const PORT = process.env.PORT || 3001;
const SHARED_SECRET = process.env.WHATSAPP_SHARED_SECRET || "";
const SESSION_PATH = process.env.SESSION_PATH || "./.wwebjs_auth";
// Where LocalAuth keeps the linked account (one client, so no clientId).
const SESSION_DIR = path.join(path.resolve(SESSION_PATH), "session");

// --- WhatsApp client state ---
const state = {
  connected: false,
  qr: null, // data-URL of the QR to scan while unpaired
  lastError: null,
};

// whatsapp-web.js answers some page events with async work that can fail
// once its browser is gone, as after a logout. Log that; never die of it.
process.on("unhandledRejection", (err) => {
  console.error("[whatsapp] Unhandled rejection:", err);
});

// The live client. Events from one being shut down are ignored.
let client = null;
// Stops and starts run one at a time, so two browsers never share the
// session folder.
let lifecycle = Promise.resolve();

function inTurn(step) {
  const run = lifecycle.then(step);
  lifecycle = run.catch(() => {});
  return run;
}

function createClient() {
  const c = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });

  c.on("qr", async (qr) => {
    if (c !== client) return;
    state.connected = false;
    try {
      state.qr = await QRCode.toDataURL(qr);
    } catch (err) {
      state.qr = null;
      state.lastError = String(err);
    }
    console.log("[whatsapp] QR generated — scan it from the admin app to pair.");
  });

  c.on("ready", () => {
    if (c !== client) return;
    state.connected = true;
    state.qr = null;
    state.lastError = null;
    console.log("[whatsapp] Client is ready and connected.");
  });

  c.on("authenticated", () => {
    console.log("[whatsapp] Authenticated.");
  });

  c.on("auth_failure", (msg) => {
    if (c !== client) return;
    state.connected = false;
    state.lastError = `auth_failure: ${msg}`;
    console.error("[whatsapp] Auth failure:", msg);
  });

  c.on("disconnected", (reason) => {
    if (c !== client) return; // one we are shutting down ourselves
    state.connected = false;
    state.lastError = `disconnected: ${reason}`;
    console.warn("[whatsapp] Disconnected:", reason);
    // Start over with a fresh client: it reconnects, or shows a new QR when
    // the device was unlinked from the phone (LOGOUT).
    restart(c, { forget: reason === "LOGOUT" }).catch((err) =>
      console.error("[whatsapp] Restart failed:", err),
    );
  });

  return c;
}

// Failed starts in a row. On a fresh session (first setup, or after an
// unlink) WhatsApp Web can reload itself while whatsapp-web.js hooks in, and
// initialize() fails; a new client then gets through, so try again, waiting
// longer each time.
let failures = 0;

function start() {
  const c = createClient();
  client = c;
  state.connected = false;
  state.qr = null;
  console.log("[whatsapp] Starting WhatsApp Web…");
  c.initialize().then(
    () => {
      if (c === client) failures = 0;
    },
    (err) => {
      if (c !== client) return;
      failures += 1;
      const delay = Math.min(5000 * 2 ** (failures - 1), 60000);
      state.lastError = String(err);
      console.error(`[whatsapp] initialize() failed, trying again in ${delay / 1000}s:`, err);
      setTimeout(() => {
        restart(c).catch((e) => console.error("[whatsapp] Restart failed:", e));
      }, delay);
    },
  );
}

// Close a client's browser and make sure it has exited: whatsapp-web.js may
// be closing it already, a stuck one must not hold up every restart after
// it, and the next client needs the session folder.
async function stop(c) {
  const proc = c.pupBrowser?.process?.();
  try {
    await withTimeout(c.destroy(), 10000);
  } catch (err) {
    console.warn("[whatsapp] Closing the browser failed:", err.message || err);
  }
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    const exited = new Promise((resolve) => proc.once("exit", resolve));
    proc.kill("SIGKILL");
    await withTimeout(exited, 10000).catch(() => console.warn("[whatsapp] The old browser did not exit."));
  }
}

// Chromium on Windows can hold its files for a moment after it exits.
async function forgetSession() {
  await fs.promises
    .rm(SESSION_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
    .catch((err) => console.warn("[whatsapp] Could not delete the session:", err.message));
}

function restart(old, { forget = false } = {}) {
  return inTurn(async () => {
    if (client !== old) return; // replaced already
    client = null;
    await stop(old);
    if (forget) await forgetSession();
    start();
  });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Unlink the paired account: WhatsApp drops this server from the phone's
// Linked devices, the session is deleted, and a fresh client shows a new QR.
// Resolves to whether WhatsApp confirmed the logout; when it did not, the
// phone may still list the device until it is logged out there.
function unlink() {
  return inTurn(async () => {
    const c = client;
    if (!c || !state.connected) {
      throw Object.assign(new Error("WhatsApp is not linked."), { status: 409 });
    }
    client = null; // the disconnect the logout causes is ours, not a drop
    state.connected = false;
    state.qr = null;
    state.lastError = null;
    let confirmed = true;
    try {
      await withTimeout(c.logout(), 20000);
    } catch (err) {
      confirmed = false;
      console.warn("[whatsapp] Logout failed, deleting the session anyway:", err);
    }
    await stop(c);
    await forgetSession();
    start();
    console.log("[whatsapp] Unlinked.");
    return confirmed;
  });
}

start();

// --- HTTP API ---
const app = express();
// Room for a picture sent along (base64, so a third larger than the file).
app.use(express.json({ limit: "16mb" }));

// Unauthenticated liveness probe (used by docker healthcheck).
app.get("/health", (_req, res) => res.json({ ok: true }));

// Shared-secret auth for everything else.
app.use((req, res, next) => {
  if (!SHARED_SECRET) return next(); // allow when no secret configured (dev)
  if (req.get("x-api-key") === SHARED_SECRET) return next();
  return res.status(401).json({ error: "unauthorized" });
});

app.get("/status", (_req, res) => {
  res.json({
    connected: state.connected,
    // The paired account's own number (digits), so the backend can tell when
    // it is asked to message itself.
    number: state.connected ? client?.info?.wid?.user || null : null,
    qr: state.connected ? null : state.qr,
    error: state.lastError,
  });
});

// { number, message } sends text. With media: { mimetype, data (base64),
// filename } it sends that file, with the message as its caption.
app.post("/send", async (req, res) => {
  const { number, message, media } = req.body || {};
  if (!number || (!message && !media)) {
    return res.status(400).json({ error: "number and message (or media) are required" });
  }
  if (media && (!media.mimetype || !media.data)) {
    return res.status(400).json({ error: "media needs mimetype and data" });
  }
  if (!state.connected || !client) {
    return res.status(409).json({ error: "WhatsApp is not connected. Pair it first." });
  }
  try {
    const chatId = `${String(number).replace(/\D/g, "")}@c.us`;
    const sent = media
      ? await client.sendMessage(chatId, new MessageMedia(media.mimetype, media.data, media.filename || null), {
          caption: message || undefined,
        })
      : await client.sendMessage(chatId, message);
    res.json({ success: true, id: sent?.id?._serialized || null });
  } catch (err) {
    console.error("[whatsapp] send failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

// Unlink the paired account; a new QR follows. Answers { success, confirmed }:
// confirmed is false when WhatsApp did not answer the logout.
app.post("/unlink", async (_req, res) => {
  try {
    res.json({ success: true, confirmed: await unlink() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on http://localhost:${PORT}`);
});
