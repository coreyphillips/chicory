import { Buffer } from 'buffer';
import { Linking, NativeModules, Platform } from 'react-native';
import { MAX_MESSAGE_BYTES, paymentUris } from '../src/services/ndef';
import { setTapPresenter, tapPresenter } from '../src/services/tapPresenter';
import { fakeTapPresenter, messageRecords } from '../test-support/tap';

/**
 * The seam between Receive and the phone acting as an NFC tag
 * (docs/TAP-TO-PAY.md), over a stand-in for the native module, which no Jest
 * run has and no iPhone build either.
 */

interface NativeStub {
  status: jest.Mock;
  present: jest.Mock;
  withdraw: jest.Mock;
}

function native(over: Partial<NativeStub> = {}): NativeStub {
  const stub: NativeStub = {
    status: jest.fn(async () => 'ready'),
    present: jest.fn(async () => 'presented'),
    withdraw: jest.fn(async () => {}),
    ...over,
  };
  NativeModules.ChicoryNfcPresenter = stub;
  return stub;
}

/** What a phone that read the presented bytes would hand its scanner. */
const readBack = (base64: string) =>
  paymentUris(messageRecords(Buffer.from(base64, 'base64')));

const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const UNIFIED = `bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.00024425&lightning=${INVOICE}`;
const LATER = 1_900_000_000_000;

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => {
  delete NativeModules.ChicoryNfcPresenter;
  setTapPresenter(null);
  jest.restoreAllMocks();
  // Linking is a mock already, so restoring leaves its calls where they are.
  jest.clearAllMocks();
});

describe('with no native module', () => {
  test('there is no presenter, as under Jest and in a build made before it', () => {
    expect(tapPresenter()).toBeNull();
  });

  test('a stand-in is the presenter until it is put back', () => {
    const fake = fakeTapPresenter();
    setTapPresenter(fake);
    expect(tapPresenter()).toBe(fake);
    setTapPresenter(null);
    expect(tapPresenter()).toBeNull();
  });
});

describe('on an iPhone', () => {
  test('there is no presenter whatever the build holds: an iPhone app cannot act as a tag', () => {
    native();
    jest.replaceProperty(Platform, 'OS', 'ios');
    expect(tapPresenter()).toBeNull();
  });
});

describe('the presenter', () => {
  test('is one object for as long as the module is', () => {
    native();
    expect(tapPresenter()).toBe(tapPresenter());
  });

  test.each([
    ['ready', 'ready'],
    ['off', 'off'],
    ['missing', 'missing'],
    ['something newer', 'missing'],
  ])('says the phone is %s as %s', async (answer, status) => {
    native({ status: jest.fn(async () => answer) });
    await expect(tapPresenter()!.status()).resolves.toBe(status);
  });

  test('takes a module that cannot answer for a phone that cannot present', async () => {
    native({
      status: jest.fn(async () => {
        throw new Error('gone');
      }),
    });
    await expect(tapPresenter()!.status()).resolves.toBe('missing');
  });

  test('hands the phone the request as a whole message, with when it runs out', async () => {
    const stub = native();
    await expect(tapPresenter()!.present(UNIFIED, LATER)).resolves.toBe(
      'presented',
    );
    expect(stub.present).toHaveBeenCalledTimes(1);
    const [message, expiresAt] = stub.present.mock.calls[0];
    expect(expiresAt).toBe(LATER);
    // The code's own string, as a phone held to this one reads it.
    expect(readBack(message)).toEqual([UNIFIED]);
  });

  test('presents a bare invoice behind the scheme a reader matches it by', async () => {
    const stub = native();
    await tapPresenter()!.present(INVOICE, LATER);
    expect(readBack(stub.present.mock.calls[0][0])).toEqual([
      `lightning:${INVOICE}`,
    ]);
  });

  test('presents nothing for a request larger than a reader takes, and nothing older either', async () => {
    const stub = native();
    const huge = `bitcoin:?lightning=${'q'.repeat(MAX_MESSAGE_BYTES)}`;
    await expect(tapPresenter()!.present(huge, LATER)).resolves.toBe(
      'TAP_TOO_LARGE',
    );
    expect(stub.present).not.toHaveBeenCalled();
    expect(stub.withdraw).toHaveBeenCalledTimes(1);
  });

  test.each([
    'TAP_TOO_LARGE',
    'TAP_OFF',
    'TAP_NOT_IN_FRONT',
    'TAP_EXPIRED',
    'TAP_REFUSED',
  ])('says why the phone is not presenting: %s', async code => {
    native({ present: jest.fn(async () => code) });
    await expect(tapPresenter()!.present(UNIFIED, LATER)).resolves.toBe(code);
  });

  test.each([
    [
      'fails',
      jest.fn(async () => {
        throw new Error('NFC is unavailable.');
      }),
    ],
    ['answers something it does not know', jest.fn(async () => 'yes')],
    ['answers as an older module did', jest.fn(async () => true)],
  ])('is not presenting when the phone %s', async (_, present) => {
    native({ present });
    await expect(tapPresenter()!.present(UNIFIED, LATER)).resolves.toBe(
      'TAP_REFUSED',
    );
  });

  test('withdraws, and a module that has gone is no failure', async () => {
    const stub = native();
    await tapPresenter()!.withdraw();
    expect(stub.withdraw).toHaveBeenCalledTimes(1);
    stub.withdraw.mockRejectedValue(new Error('gone'));
    await expect(tapPresenter()!.withdraw()).resolves.toBeUndefined();
  });

  test('opens the NFC settings, or the app settings on a phone without that screen', async () => {
    native();
    const intent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await tapPresenter()!.openSettings();
    expect(intent).toHaveBeenCalledWith('android.settings.NFC_SETTINGS');
    expect(settings).not.toHaveBeenCalled();
    intent.mockRejectedValue(new Error('No such screen.'));
    await tapPresenter()!.openSettings();
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
