/**
 * NFC stand-ins for tap to pay (docs/TAP-TO-PAY.md): the records a tag hands
 * over, built as the phone's NFC stack reports them, and a reader the tests
 * and the state gallery hold a tag to. Nothing here needs Jest, so the
 * gallery can use it on a phone.
 */
import { Buffer } from 'buffer';
import type { TapRecord } from '../src/services/ndef';
import { TapError } from '../src/services/tapReader';
import type { TapCode, TapReader, TapStatus } from '../src/services/tapReader';

const base64 = (bytes: Uint8Array | number[]) =>
  Buffer.from(bytes as Uint8Array).toString('base64');

/** A record of any kind, from its bytes. */
export function recordOf(
  tnf: number,
  type: Uint8Array | number[] | string,
  payload: Uint8Array | number[] | string,
): TapRecord {
  const bytes = (value: Uint8Array | number[] | string) =>
    typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return { tnf, type: base64(bytes(type)), payload: base64(bytes(payload)) };
}

/**
 * A URI record as a payment terminal writes one: well-known type `U`, the
 * identifier `code` (0, nothing abbreviated), then the rest as text.
 */
export function uriRecord(uri: string, code = 0): TapRecord {
  return recordOf(1, 'U', [code, ...Buffer.from(uri, 'utf8')]);
}

export interface FakeTapReader extends TapReader {
  /** What `status` answers next. */
  answer: TapStatus;
  /** How many times each was asked. */
  asked: { status: number; read: number; cancel: number; settings: number };
  /** The line the last read was asked with. */
  prompt: string | null;
  /** Whether a read is waiting for a tag. */
  reading(): boolean;
  /** A tag is held to the phone, and the waiting read gets its records. */
  tag(records: TapRecord[]): void;
  /** The waiting read ends with `code`. */
  fail(code: TapCode): void;
}

/** A reader that waits for `tag` or `fail`, as the phone waits for a tag. */
export function fakeTapReader(
  mode: TapReader['mode'] = 'ambient',
  answer: TapStatus = 'ready',
): FakeTapReader {
  let waiting: {
    resolve: (records: TapRecord[]) => void;
    reject: (error: Error) => void;
  } | null = null;
  const settle = () => {
    const held = waiting;
    waiting = null;
    return held;
  };
  const reader: FakeTapReader = {
    mode,
    answer,
    asked: { status: 0, read: 0, cancel: 0, settings: 0 },
    prompt: null,
    async status() {
      reader.asked.status += 1;
      return reader.answer;
    },
    read(prompt) {
      reader.asked.read += 1;
      reader.prompt = prompt;
      settle()?.reject(new TapError('TAP_CANCELLED'));
      return new Promise((resolve, reject) => {
        waiting = { resolve, reject };
      });
    },
    async cancel() {
      reader.asked.cancel += 1;
      settle()?.reject(new TapError('TAP_CANCELLED'));
    },
    async openSettings() {
      reader.asked.settings += 1;
    },
    reading: () => waiting !== null,
    tag: records => settle()?.resolve(records),
    fail: code => settle()?.reject(new TapError(code)),
  };
  return reader;
}
