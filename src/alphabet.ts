/**
 * The 64 PLID characters, ascending by code point (§ 1) — which is what makes
 * byte order equal numeric order. Not base64url: its index 0 is `A` (0x41) and
 * its index 62 is `-` (0x2D), so base64url does not sort.
 */
export const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz~";

/** Code point → index, or -1. Every PLID character is ASCII. */
const INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET.charCodeAt(i)] = i;

function digit(text: string, at: number): number {
  const code = text.charCodeAt(at);
  const value = code < 128 ? INDEX[code] : -1;
  if (value < 0) {
    throw new SyntaxError(`invalid PLID character: ${JSON.stringify(text[at])}`);
  }
  return value;
}

/**
 * The 8 leading characters of a 48-bit stamp (§ 2). No BigInt needed: 2^48 is
 * exact in a double, and two 24-bit halves shift as int32s.
 */
export function encodeStamp(stamp: number): string {
  const hi = Math.floor(stamp / 0x100_0000);
  const lo = stamp % 0x100_0000;
  return (
    ALPHABET[(hi >>> 18) & 63] +
    ALPHABET[(hi >>> 12) & 63] +
    ALPHABET[(hi >>> 6) & 63] +
    ALPHABET[hi & 63] +
    ALPHABET[(lo >>> 18) & 63] +
    ALPHABET[(lo >>> 12) & 63] +
    ALPHABET[(lo >>> 6) & 63] +
    ALPHABET[lo & 63]
  );
}

/** A `6 * chars`-bit entropy field as `chars` characters; empty at K=0. */
export function encodeTail(entropy: bigint, chars: number): string {
  let v = entropy;
  let s = "";
  for (let i = 0; i < chars; i++) {
    s = ALPHABET[Number(v & 63n)] + s;
    v >>= 6n;
  }
  return s;
}

/** The 48-bit stamp: `id`'s first 8 characters. Throws on a character outside § 1. */
export function parseStamp(id: string): number {
  let v = 0;
  for (let i = 0; i < 8; i++) v = v * 64 + digit(id, i);
  return v;
}

/** The entropy field: everything after the stamp. */
export function parseTail(id: string): bigint {
  let v = 0n;
  for (let i = 8; i < id.length; i++) v = (v << 6n) | BigInt(digit(id, i));
  return v;
}

/** True when every character of `text` is in the alphabet. Empty text is valid. */
export function isAlphabet(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 128 || INDEX[code] < 0) return false;
  }
  return true;
}
