import { Buffer } from 'buffer';
import { Linking, NativeModules, Platform } from 'react-native';
import { presentedUri, uriMessage } from './ndef';
import type { TapStatus } from './tapReader';

/**
 * Presenting a request as an NFC tag, so a phone held to this one reads it
 * (docs/TAP-TO-PAY.md). It is the other half of `tapReader`: there the phone
 * reads a tag, and here it answers as one.
 *
 * Receive sees only this seam. Behind it is the `ChicoryNfcPresenter`
 * module, which an Android build has and no iPhone build does: an iPhone app
 * may read a tag and may not act as one. Under Jest, on an iPhone, and in a
 * build made before the module was added there is no presenter, and Receive
 * draws nothing for it.
 *
 * The message is written here, in `ndef.ts`, and native code serves its
 * bytes without reading them. A request is presented only between `present`
 * and `withdraw`, and native code withdraws by itself as the app leaves the
 * front and as the request runs out, so a request cannot outlive its screen
 * while JavaScript is paused.
 */
/** Why a request is not presented. Each is a code for the diagnostic log. */
export type PresentRefusal =
  /** The request is larger than a reader takes. */
  | 'TAP_TOO_LARGE'
  /** NFC went off, or was never there, between being asked and presenting. */
  | 'TAP_OFF'
  /** The app had left the front by the time the phone was asked. */
  | 'TAP_NOT_IN_FRONT'
  /** The request had run out by the time the phone was asked. */
  | 'TAP_EXPIRED'
  /** The phone would not answer for the request, or the module failed. */
  | 'TAP_REFUSED';

const REFUSALS: readonly PresentRefusal[] = [
  'TAP_TOO_LARGE',
  'TAP_OFF',
  'TAP_NOT_IN_FRONT',
  'TAP_EXPIRED',
  'TAP_REFUSED',
];

export interface TapPresenter {
  /** This phone cannot act as a tag, NFC is switched off, or it can. */
  status(): Promise<TapStatus>;
  /**
   * Answers a reader with `request` from now until `expiresAt`, in place of
   * whatever was presented before. Answers `presented`, or why it is not, in
   * which case nothing is presented, not even the request before.
   */
  present(
    request: string,
    expiresAt: number,
  ): Promise<'presented' | PresentRefusal>;
  /** Presents nothing from now. Safe when nothing is presented. */
  withdraw(): Promise<void>;
  /** Opens the device's NFC settings, for a phone whose NFC is off. */
  openSettings(): Promise<void>;
}

interface NativePresenter {
  status(): Promise<string>;
  present(message: string, expiresAt: number): Promise<string>;
  withdraw(): Promise<void>;
}

function over(native: NativePresenter): TapPresenter {
  return {
    async status() {
      try {
        const answer = await native.status();
        return answer === 'ready' || answer === 'off' ? answer : 'missing';
      } catch {
        return 'missing';
      }
    },
    async present(request, expiresAt) {
      const message = uriMessage(presentedUri(request));
      try {
        if (!message) {
          // Nothing of an older request is left behind a refused one.
          await native.withdraw();
          return 'TAP_TOO_LARGE';
        }
        const answer = await native.present(
          Buffer.from(message).toString('base64'),
          expiresAt,
        );
        if (answer === 'presented') return answer;
        return REFUSALS.includes(answer as PresentRefusal)
          ? (answer as PresentRefusal)
          : 'TAP_REFUSED';
      } catch {
        return 'TAP_REFUSED';
      }
    },
    async withdraw() {
      try {
        await native.withdraw();
      } catch {
        // Nothing was presented, or the module has gone with its host.
      }
    },
    async openSettings() {
      try {
        await Linking.sendIntent('android.settings.NFC_SETTINGS');
        return;
      } catch {
        // A phone without that screen falls back to the app's own settings.
      }
      await Linking.openSettings().catch(() => {});
    },
  };
}

// One presenter per native module, so whoever holds it sees the same object
// from one render to the next.
let builtFor: NativePresenter | undefined;
let built: TapPresenter | null = null;

function nativePresenter(): TapPresenter | null {
  const module: NativePresenter | undefined =
    Platform.OS === 'android' ? NativeModules.ChicoryNfcPresenter : undefined;
  if (module !== builtFor) {
    builtFor = module;
    built = module ? over(module) : null;
  }
  return built;
}

let standIn: TapPresenter | null = null;

/** Stands `presenter` in for the native one, or puts it back with null. */
export function setTapPresenter(presenter: TapPresenter | null) {
  standIn = presenter;
}

/** The presenter, or null where there is none, as under Jest and on iPhone. */
export function tapPresenter(): TapPresenter | null {
  return standIn ?? nativePresenter();
}
