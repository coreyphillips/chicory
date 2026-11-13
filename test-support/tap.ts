/**
 * NFC stand-ins for tap to pay (docs/TAP-TO-PAY.md): the records a tag hands
 * over, built as the phone's NFC stack reports them, and a reader the tests
 * and the state gallery hold a tag to. Nothing here needs Jest, so the
 * gallery can use it on a phone.
 */
import { Buffer } from 'buffer';
import type { TapRecord } from '../src/services/ndef';
import type {
  PresentRefusal,
  TapPresenter,
} from '../src/services/tapPresenter';
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

/* eslint-disable no-bitwise -- a record's header is flags in one byte */
/**
 * A tag's message taken apart into its records, as a phone's NFC stack does
 * before it hands them over: each record's flags, its type, an id if it has
 * one, and its payload, short or long. Throws on a message that does not end
 * where its records say.
 */
export function messageRecords(message: Uint8Array): TapRecord[] {
  const records: TapRecord[] = [];
  let at = 0;
  const take = (count: number) => {
    if (at + count > message.length) throw new Error('The message is cut.');
    const bytes = message.subarray(at, at + count);
    at += count;
    return bytes;
  };
  let ended = false;
  while (at < message.length) {
    if (ended) throw new Error('A record follows the last.');
    const flags = take(1)[0];
    const short = flags & 0x10;
    const typeLength = take(1)[0];
    const length = short
      ? take(1)[0]
      : take(4).reduce((sum, byte) => sum * 256 + byte, 0);
    const idLength = flags & 0x08 ? take(1)[0] : 0;
    const type = take(typeLength);
    take(idLength);
    const payload = take(length);
    if (records.length === 0 && !(flags & 0x80))
      throw new Error('The first record does not begin the message.');
    ended = !!(flags & 0x40);
    records.push({
      tnf: flags & 0x07,
      type: base64(type),
      payload: base64(payload),
    });
  }
  if (!ended) throw new Error('No record ends the message.');
  return records;
}
/* eslint-enable no-bitwise */

export interface FakeTapPresenter extends TapPresenter {
  /** What `status` answers next. */
  answer: TapStatus;
  /** Why the phone will not present what it is asked to, or null if it will. */
  refuses: PresentRefusal | null;
  /** How many times each was asked. */
  asked: {
    status: number;
    present: number;
    withdraw: number;
    settings: number;
  };
  /** What a reader held to the phone would be given now, or null. */
  presented: { request: string; expiresAt: number } | null;
  /** Each request presented and each withdrawal, in the order they came. */
  log: string[];
}

/** A presenter that keeps what it was last asked to present. */
export function fakeTapPresenter(
  answer: TapStatus = 'ready',
): FakeTapPresenter {
  const presenter: FakeTapPresenter = {
    answer,
    refuses: null,
    asked: { status: 0, present: 0, withdraw: 0, settings: 0 },
    presented: null,
    log: [],
    async status() {
      presenter.asked.status += 1;
      return presenter.answer;
    },
    async present(request, expiresAt) {
      presenter.asked.present += 1;
      const refusal = presenter.refuses;
      presenter.presented = refusal ? null : { request, expiresAt };
      presenter.log.push(refusal ? 'refused' : request);
      return refusal ?? 'presented';
    },
    async withdraw() {
      presenter.asked.withdraw += 1;
      presenter.presented = null;
      presenter.log.push('withdrawn');
    },
    async openSettings() {
      presenter.asked.settings += 1;
    },
  };
  return presenter;
}
