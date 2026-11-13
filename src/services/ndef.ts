import { fromBase64 } from '../embedded/base64';

const { TextDecoder } = require('text-encoding');

/**
 * What an NFC tag's records say (docs/TAP-TO-PAY.md).
 *
 * The phone's own NFC stack reads the tag: it loops the chunked reads, takes
 * the long record format apart and hands over records. Native code passes
 * them on untouched, so the one rule for what a tag may say lives here, the
 * same on both platforms and under Jest.
 *
 * A payment terminal presents one URI record holding `lightning:<invoice>`
 * or `bitcoin:?lightning=<invoice>`. Nothing else on a tag is read as a
 * request: not a text record, not a web link, and not a smart poster, whose
 * link sits a level down inside a record of its own.
 */
export interface TapRecord {
  /** The record's type name format, 0 to 7. */
  tnf: number;
  /** The record's type, as base64 of its bytes. */
  type: string;
  /** The record's payload, as base64 of its bytes. */
  payload: string;
}

const TNF_WELL_KNOWN = 1;
const TNF_ABSOLUTE_URI = 3;
/** The well-known type `U`: a URI record. */
const RTD_URI = 0x55;

/**
 * What a URI record's first byte stands for (NFC Forum URI RTD): the start
 * of the address, abbreviated to one byte. `lightning:` and `bitcoin:` have
 * no abbreviation, so a request is written whole after 0x00.
 */
const URI_PREFIX = [
  '',
  'http://www.',
  'https://www.',
  'http://',
  'https://',
  'tel:',
  'mailto:',
  'ftp://anonymous:anonymous@',
  'ftp://ftp.',
  'ftps://',
  'sftp://',
  'smb://',
  'nfs://',
  'ftp://',
  'dav://',
  'news:',
  'telnet://',
  'imap:',
  'rtsp://',
  'urn:',
  'pop:',
  'sip:',
  'sips:',
  'tftp:',
  'btspp://',
  'btl2cap://',
  'btgoep://',
  'tcpobex://',
  'irdaobex://',
  'file://',
  'urn:epc:id:',
  'urn:epc:tag:',
  'urn:epc:pat:',
  'urn:epc:raw:',
  'urn:epc:',
  'urn:nfc:',
];

/** Bytes as text, or null when they are not UTF-8. */
function text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The address a record holds, or null when it is not a URI record. */
export function recordUri(record: TapRecord): string | null {
  if (typeof record?.type !== 'string' || typeof record?.payload !== 'string') {
    return null;
  }
  const type = fromBase64(record.type);
  if (record.tnf === TNF_ABSOLUTE_URI) return text(type);
  if (record.tnf !== TNF_WELL_KNOWN) return null;
  if (type.length !== 1 || type[0] !== RTD_URI) return null;
  const payload = fromBase64(record.payload);
  if (payload.length < 2) return null;
  // A code past the table is reserved, and such a record says nothing.
  const prefix = URI_PREFIX[payload[0]];
  if (prefix === undefined) return null;
  const rest = text(payload.subarray(1));
  return rest === null ? null : prefix + rest;
}

const PAYMENT_SCHEME = /^(bitcoin|lightning):/i;

/**
 * The payment links among a tag's records, in the tag's order and as the tag
 * wrote them. Whether one of them can be paid is the payment parser's to say.
 */
export function paymentUris(records: TapRecord[]): string[] {
  if (!Array.isArray(records)) return [];
  const found: string[] = [];
  for (const record of records) {
    const uri = recordUri(record)?.trim();
    if (uri && PAYMENT_SCHEME.test(uri)) found.push(uri);
  }
  return found;
}
