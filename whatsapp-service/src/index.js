require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const PORT = process.env.PORT || 3001;
const SHARED_SECRET = process.env.WHATSAPP_SHARED_SECRET || "";
const SESSION_PATH = process.env.SESSION_PATH || "./.wwebjs_auth";

// --- WhatsApp client state ---
const state = {
  connected: false,
  qr: null, // data-URL of the QR to scan while unpaired
  lastError: null,
};

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  },
});

client.on("qr", async (qr) => {
  state.connected = false;
  try {
    state.qr = await QRCode.toDataURL(qr);
  } catch (err) {
    state.qr = null;
    state.lastError = String(err);
  }
  console.log("[whatsapp] QR generated — scan it from the admin app to pair.");
});

client.on("ready", () => {
  state.connected = true;
  state.qr = null;
  state.lastError = null;
  console.log("[whatsapp] Client is ready and connected.");
});

client.on("authenticated", () => {
  console.log("[whatsapp] Authenticated.");
});

client.on("auth_failure", (msg) => {
  state.connected = false;
  state.lastError = `auth_failure: ${msg}`;
  console.error("[whatsapp] Auth failure:", msg);
});

client.on("disconnected", (reason) => {
  state.connected = false;
  state.lastError = `disconnected: ${reason}`;
  console.warn("[whatsapp] Disconnected:", reason);
  // Attempt to re-initialize so a new QR can be issued.
  client.initialize().catch((e) => console.error("[whatsapp] re-init failed", e));
});

client.initialize().catch((err) => {
  state.lastError = String(err);
  console.error("[whatsapp] initialize() failed:", err);
});

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
    number: state.connected ? client.info?.wid?.user || null : null,
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
  if (!state.connected) {
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

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on http://localhost:${PORT}`);
});
