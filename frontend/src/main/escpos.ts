/**
 * ESC/POS receipt printing and cash drawer control.
 *
 * Thermal printers take raw byte commands, not HTML. Going through the
 * Electron print dialog costs a click per sale and renders slowly; this path
 * is silent and near-instant, which is what a queue at the till needs.
 *
 * Two transports, both dependency-free so there is no native module to
 * compile at install time:
 *   - network: nearly all counter-top printers listen on TCP 9100
 *   - device:  a Windows share (\\host\printer) or /dev/usb/lp0 on Linux
 */
import { createWriteStream } from "fs";
import { Socket } from "net";

const ESC = 0x1b;
const GS = 0x1d;

export interface PrinterConfig {
  transport: "network" | "device" | "none";
  host?: string;
  port?: number;
  path?: string;
  /** Characters per line: 32 for 58mm paper, 42 for 80mm. */
  width?: number;
  codepage?: number;
}

export interface ReceiptLine {
  left?: string;
  right?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  double?: boolean;
  /** Draw a divider instead of text. */
  rule?: boolean;
  feed?: number;
}

class Builder {
  private chunks: number[] = [];
  constructor(private width: number) {}

  raw(...bytes: number[]) {
    this.chunks.push(...bytes);
    return this;
  }

  text(value: string) {
    for (const byte of Buffer.from(value, "latin1")) this.chunks.push(byte);
    return this;
  }

  init(codepage = 0) {
    return this.raw(ESC, 0x40).raw(ESC, 0x74, codepage);
  }

  align(mode: "left" | "center" | "right") {
    const map = { left: 0, center: 1, right: 2 } as const;
    return this.raw(ESC, 0x61, map[mode]);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  double(on: boolean) {
    // Width and height doubling share one size byte.
    return this.raw(GS, 0x21, on ? 0x11 : 0x00);
  }

  line(value = "") {
    return this.text(value).raw(0x0a);
  }

  /** Pad a label and amount to opposite edges — the usual receipt layout. */
  columns(left: string, right: string) {
    const gap = Math.max(1, this.width - left.length - right.length);
    if (left.length + right.length >= this.width) {
      // Too long to fit: put the amount on its own right-aligned line.
      this.line(left.slice(0, this.width));
      return this.line(right.padStart(this.width));
    }
    return this.line(left + " ".repeat(gap) + right);
  }

  rule(char = "-") {
    return this.line(char.repeat(this.width));
  }

  feed(lines = 1) {
    return this.raw(ESC, 0x64, lines);
  }

  cut() {
    // Feed clear of the cutter first, then partial cut.
    return this.feed(3).raw(GS, 0x56, 0x42, 0x00);
  }

  /** Fire the drawer solenoid on pin 2 (the near-universal wiring). */
  kick() {
    return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa);
  }

  build(): Buffer {
    return Buffer.from(this.chunks);
  }
}

export function buildReceipt(lines: ReceiptLine[], config: PrinterConfig): Buffer {
  const width = config.width ?? 42;
  const b = new Builder(width).init(config.codepage ?? 0);

  for (const line of lines) {
    if (line.rule) {
      b.rule();
      continue;
    }
    if (line.feed) {
      b.feed(line.feed);
      continue;
    }
    b.align(line.align ?? "left");
    if (line.bold) b.bold(true);
    if (line.double) b.double(true);

    if (line.right !== undefined) {
      b.columns(line.left ?? "", line.right);
    } else {
      b.line(line.left ?? "");
    }

    if (line.double) b.double(false);
    if (line.bold) b.bold(false);
  }

  return b.cut().build();
}

export function buildDrawerKick(): Buffer {
  return new Builder(42).kick().build();
}

function sendNetwork(payload: Buffer, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    // A wedged printer must not hang the till.
    socket.setTimeout(5000);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Printer at ${host}:${port} did not respond.`));
    });
    socket.connect(port, host, () => {
      socket.write(payload, () => socket.end());
    });
    socket.once("close", () => resolve());
  });
}

function sendDevice(payload: Buffer, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path, { flags: "a" });
    stream.once("error", reject);
    stream.write(payload, (err) => {
      if (err) return reject(err);
      stream.end(() => resolve());
    });
  });
}

export async function sendToPrinter(
  payload: Buffer,
  config: PrinterConfig
): Promise<void> {
  if (config.transport === "network") {
    if (!config.host) throw new Error("No printer host configured.");
    return sendNetwork(payload, config.host, config.port ?? 9100);
  }
  if (config.transport === "device") {
    if (!config.path) throw new Error("No printer device path configured.");
    return sendDevice(payload, config.path);
  }
  throw new Error("No thermal printer is configured.");
}
