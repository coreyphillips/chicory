import { Linking, NativeModules, Platform } from 'react-native';
import type { TapRecord } from './ndef';

/**
 * Reading an NFC tag, such as a payment terminal presents
 * (docs/TAP-TO-PAY.md).
 *
 * The scanner sees only this seam. Behind it is the `ChicoryNfc` module, in
 * a build that has one, which hands back a tag's records and reads nothing
 * into them (`ndef.ts` does that). Under Jest, and in a build made before the
 * module was added, there is no reader and the scanner draws nothing for it.
 *
 * The two platforms read differently, and `mode` says which:
 *
 * - `ambient`, Android: the phone reads whatever is held to it for as long
 *   as it is asked to. `read` resolves with the next tag, and the radio stays
 *   the app's between reads, until `cancel`. While it does, Android offers a
 *   tag to no other app and the phone's own card wallet is off, so the
 *   scanner asks only while it is open.
 * - `prompted`, iPhone: `read` raises the system's sheet for one tag, with
 *   `prompt` as its line. It ends within `TAP_DEADLINE_MS`.
 */
export type TapStatus = 'missing' | 'off' | 'ready';

export type TapCode =
  /** The read was called off, by the person or by the app. */
  | 'TAP_CANCELLED'
  /** No tag came while the system's sheet was up. */
  | 'TAP_TIMEOUT'
  /** A tag was read and holds no NDEF message. */
  | 'TAP_NO_NDEF'
  /** A tag's message is larger than any payment request. */
  | 'TAP_TOO_LARGE'
  /** Anything else: the radio is off or busy, or the tag was lost mid read. */
  | 'TAP_FAILED';

const CODES: readonly TapCode[] = [
  'TAP_CANCELLED',
  'TAP_TIMEOUT',
  'TAP_NO_NDEF',
  'TAP_TOO_LARGE',
  'TAP_FAILED',
];

/** A read that gave no records, with why. */
export class TapError extends Error {
  code: TapCode;
  constructor(code: TapCode) {
    super(code);
    this.name = 'TapError';
    this.code = code;
  }
}

/** Why a read failed. Anything that is not one of the codes is a failure. */
export function tapCode(error: unknown): TapCode {
  const code = (error as { code?: unknown } | null)?.code;
  return CODES.includes(code as TapCode) ? (code as TapCode) : 'TAP_FAILED';
}

export interface TapReader {
  mode: 'ambient' | 'prompted';
  /** No NFC in this phone or build, NFC switched off, or ready to read. */
  status(): Promise<TapStatus>;
  /** One tag's records, or a `TapError`. */
  read(prompt: string): Promise<TapRecord[]>;
  /** Ends a read and gives the radio back. Safe when nothing is reading. */
  cancel(): Promise<void>;
  /** Opens the device's NFC settings, for a phone whose NFC is off. */
  openSettings(): Promise<void>;
}

/**
 * How long the system's sheet may stay up. The app lock counts a prompt as
 * time away and locks after 30 seconds of it (`BACKGROUND_GRACE_MS` in
 * `useAppLock`), and iOS would hold its sheet for 60, so a slow tap could
 * come back to a lock screen. Ending the read first keeps it inside the
 * grace, with room for the sheet to leave.
 */
export const TAP_DEADLINE_MS = 20_000;

/**
 * What the native module answers when it can never read: an iPhone build
 * signed without the tag reading entitlement has the module and no right to
 * use it.
 */
const UNAVAILABLE = 'TAP_UNAVAILABLE';

interface NativeTap {
  status(): Promise<string>;
  read(prompt: string): Promise<unknown>;
  cancel(): Promise<void>;
}

/** The records native code handed over, or a failure when they are not that. */
function recordsOf(value: unknown): TapRecord[] {
  if (!Array.isArray(value)) throw new TapError('TAP_FAILED');
  return value.map(record => {
    if (
      !record ||
      typeof record.tnf !== 'number' ||
      typeof record.type !== 'string' ||
      typeof record.payload !== 'string'
    ) {
      throw new TapError('TAP_FAILED');
    }
    return { tnf: record.tnf, type: record.type, payload: record.payload };
  });
}

function over(native: NativeTap): TapReader {
  const mode = Platform.OS === 'ios' ? 'prompted' : 'ambient';
  let unavailable = false;
  return {
    mode,
    async status() {
      if (unavailable) return 'missing';
      try {
        const answer = await native.status();
        return answer === 'ready' || answer === 'off' ? answer : 'missing';
      } catch {
        return 'missing';
      }
    },
    async read(prompt) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const answers: Promise<unknown>[] = [native.read(prompt)];
      if (mode === 'prompted') {
        answers.push(
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              native.cancel().catch(() => {});
              reject(new TapError('TAP_TIMEOUT'));
            }, TAP_DEADLINE_MS);
          }),
        );
      }
      try {
        return recordsOf(await Promise.race(answers));
      } catch (error) {
        if ((error as { code?: unknown } | null)?.code === UNAVAILABLE) {
          unavailable = true;
        }
        throw new TapError(tapCode(error));
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async cancel() {
      try {
        await native.cancel();
      } catch {
        // Nothing was reading, or the module has gone with its host.
      }
    },
    async openSettings() {
      try {
        if (Platform.OS === 'android') {
          await Linking.sendIntent('android.settings.NFC_SETTINGS');
          return;
        }
      } catch {
        // A phone without that screen falls back to the app's own settings.
      }
      await Linking.openSettings().catch(() => {});
    },
  };
}

// One reader per native module, so whoever holds it sees the same object
// from one render to the next.
let builtFor: NativeTap | undefined;
let built: TapReader | null = null;

function nativeReader(): TapReader | null {
  const module: NativeTap | undefined = NativeModules.ChicoryNfc;
  if (module !== builtFor) {
    builtFor = module;
    built = module ? over(module) : null;
  }
  return built;
}

let standIn: TapReader | null = null;

/** Stands `reader` in for the native one, or puts it back with null. */
export function setTapReader(reader: TapReader | null) {
  standIn = reader;
}

/** The reader, or null where there is none, as under Jest. */
export function tapReader(): TapReader | null {
  return standIn ?? nativeReader();
}
