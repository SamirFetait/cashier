require("dotenv").config();

const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

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
app.use(express.json());

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
    qr: state.connected ? null : state.qr,
    error: state.lastError,
  });
});

app.post("/send", async (req, res) => {
  const { number, message } = req.body || {};
  if (!number || !message) {
    return res.status(400).json({ error: "number and message are required" });
  }
  if (!state.connected) {
    return res.status(409).json({ error: "WhatsApp is not connected. Pair it first." });
  }
  try {
    const chatId = `${String(number).replace(/\D/g, "")}@c.us`;
    const sent = await client.sendMessage(chatId, message);
    res.json({ success: true, id: sent?.id?._serialized || null });
  } catch (err) {
    console.error("[whatsapp] send failed:", err);
    res.status(500).json({ error: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on http://localhost:${PORT}`);
});
