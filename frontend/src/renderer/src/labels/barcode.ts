/**
 * Barcode symbols for printed labels, as runs of bars and spaces.
 *
 * EAN-13 for the store's own codes and most packaged goods: every retail
 * scanner reads it with its factory settings, and the check digit catches a
 * misread. A 12-digit UPC-A prints as the EAN-13 it is equal to. Any other
 * code falls back to Code 128.
 */

export interface BarcodeSymbol {
  kind: "EAN13" | "CODE128";
  /** One character per module: "1" is a bar, "0" a space. Quiet zones excluded. */
  modules: string;
  /** Blank modules the symbol needs on each side to scan. */
  quietLeft: number;
  quietRight: number;
  /** The code as stored, which is also what the scanner types back. */
  text: string;
}

// EAN-13 digit patterns: L and G for the left half, R for the right.
const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
// The first digit is not drawn; it picks which left-half digits use G.
const EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

// Code 128 symbol values 0-105 as bar/space widths; the stop symbol is separate.
const CODE128 = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232",
];
const CODE128_STOP = "2331112";
const START_B = 104;
const START_C = 105;

export function ean13CheckDigit(data: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(data[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code) === code[12];
}

function ean13(digits: string, text: string): BarcodeSymbol {
  const parity = EAN_PARITY[Number(digits[0])];
  let modules = "101";
  for (let i = 1; i <= 6; i++) {
    const digit = Number(digits[i]);
    modules += parity[i - 1] === "L" ? EAN_L[digit] : EAN_G[digit];
  }
  modules += "01010";
  for (let i = 7; i <= 12; i++) modules += EAN_R[Number(digits[i])];
  modules += "101";
  return { kind: "EAN13", modules, quietLeft: 11, quietRight: 7, text };
}

/** Bars and spaces alternate, starting with a bar. */
function fromWidths(widths: string): string {
  let out = "";
  for (let i = 0; i < widths.length; i++) out += (i % 2 ? "0" : "1").repeat(Number(widths[i]));
  return out;
}

function code128(text: string): BarcodeSymbol | null {
  // Code set B covers printable ASCII; an even run of digits packs two per symbol in set C.
  if (!text || !/^[\x20-\x7e]+$/.test(text)) return null;
  const values =
    /^\d+$/.test(text) && text.length % 2 === 0
      ? [START_C, ...(text.match(/\d\d/g) ?? []).map(Number)]
      : [START_B, ...Array.from(text, (c) => c.charCodeAt(0) - 32)];
  const check = values.reduce((sum, value, i) => sum + value * Math.max(i, 1), 0) % 103;
  const modules = [...values, check].map((v) => fromWidths(CODE128[v])).join("") + fromWidths(CODE128_STOP);
  return { kind: "CODE128", modules, quietLeft: 10, quietRight: 10, text };
}

/** The symbol to print for a stored barcode, or null when it cannot be drawn. */
export function encodeBarcode(code: string): BarcodeSymbol | null {
  const text = code.trim();
  if (isValidEan13(text)) return ean13(text, text);
  if (/^\d{12}$/.test(text) && isValidEan13(`0${text}`)) return ean13(`0${text}`, text);
  return code128(text);
}
