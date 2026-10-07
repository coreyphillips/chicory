/* eslint-disable no-bitwise -- a base64 codec is bit arithmetic */
import { Buffer } from 'buffer';

// Sextet values by UTF-16 code unit, and -1 for anything else. A table
// over every code unit keeps the hot loop to lookups, with no range test.
const SEXTET = new Int8Array(65536).fill(-1);
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
for (let i = 0; i < 64; i++) SEXTET[ALPHABET.charCodeAt(i)] = i;
const PAD = 61; // '='

/**
 * Buffer.from(text, 'base64') in one pass. buffer@6 decodes a base64 string
 * twice, once to size the result and once to fill it, and runs a regex over
 * it both times. Every read on the iroh link arrives from native as base64,
 * and on Hermes that double decode was a large share of the JavaScript the
 * phone spends while its primary sends gossip. Anything but padded standard
 * base64 goes to buffer@6, so its exact reading of other input is kept.
 */
export function fromBase64(text: string): Buffer {
  const length = text.length;
  if (length === 0 || length % 4 !== 0) return Buffer.from(text, 'base64');
  const pad =
    text.charCodeAt(length - 1) === PAD
      ? text.charCodeAt(length - 2) === PAD
        ? 2
        : 1
      : 0;
  const out = Buffer.allocUnsafe((length / 4) * 3 - pad);
  const whole = pad ? length - 4 : length;
  let at = 0;
  // Four sextets make 24 bits; a -1 anywhere makes the whole word negative.
  // Byte stores keep the low eight bits of what they are given.
  for (let i = 0; i < whole; i += 4, at += 3) {
    const word =
      (SEXTET[text.charCodeAt(i)] << 18) |
      (SEXTET[text.charCodeAt(i + 1)] << 12) |
      (SEXTET[text.charCodeAt(i + 2)] << 6) |
      SEXTET[text.charCodeAt(i + 3)];
    if (word < 0) return Buffer.from(text, 'base64');
    out[at] = word >> 16;
    out[at + 1] = word >> 8;
    out[at + 2] = word;
  }
  if (pad) {
    const word =
      (SEXTET[text.charCodeAt(whole)] << 18) |
      (SEXTET[text.charCodeAt(whole + 1)] << 12) |
      (pad === 1 ? SEXTET[text.charCodeAt(whole + 2)] << 6 : 0);
    if (word < 0) return Buffer.from(text, 'base64');
    out[at] = word >> 16;
    if (pad === 1) out[at + 1] = word >> 8;
  }
  return out;
}
