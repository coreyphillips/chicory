import { Linking, NativeModules, Platform } from 'react-native';
import {
  TAP_DEADLINE_MS,
  TapError,
  setTapReader,
  tapCode,
  tapReader,
} from '../src/services/tapReader';
import { fs, path, ROOT } from '../test-support/node';
import { fakeTapReader, uriRecord } from '../test-support/tap';

/**
 * The seam between the scanner and the phone's NFC (docs/TAP-TO-PAY.md),
 * over a stand-in for the native module, which no Jest run has.
 */

interface NativeStub {
  status: jest.Mock;
  read: jest.Mock;
  cancel: jest.Mock;
}

/** A native module that never answers a read until a test settles it. */
function native(over: Partial<NativeStub> = {}): NativeStub {
  const stub: NativeStub = {
    status: jest.fn(async () => 'ready'),
    read: jest.fn(() => new Promise(() => {})),
    cancel: jest.fn(async () => {}),
    ...over,
  };
  NativeModules.ChicoryNfc = stub;
  return stub;
}

/** A failure as the bridge hands one over: an error with a code. */
const coded = (code: string) => Object.assign(new Error(code), { code });

afterEach(() => {
  delete NativeModules.ChicoryNfc;
  setTapReader(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
  // Linking is a mock already, so restoring leaves its calls where they are.
  jest.clearAllMocks();
});

describe('with no native module', () => {
  test('there is no reader, as under Jest and in a build made before it', () => {
    expect(tapReader()).toBeNull();
  });

  test('a stand-in is the reader until it is put back', () => {
    const fake = fakeTapReader();
    setTapReader(fake);
    expect(tapReader()).toBe(fake);
    setTapReader(null);
    expect(tapReader()).toBeNull();
  });
});

describe('the reader', () => {
  test('is one object for as long as the module is', () => {
    native();
    expect(tapReader()).toBe(tapReader());
  });

  test('listens on Android and asks on an iPhone', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    native();
    expect(tapReader()?.mode).toBe('ambient');
    jest.replaceProperty(Platform, 'OS', 'ios');
    native();
    expect(tapReader()?.mode).toBe('prompted');
  });

  test.each([
    ['ready', 'ready'],
    ['off', 'off'],
    ['missing', 'missing'],
    ['anything else', 'missing'],
    [undefined, 'missing'],
  ])('says what the phone can do: %s', async (answer, status) => {
    native({ status: jest.fn(async () => answer) });
    await expect(tapReader()!.status()).resolves.toBe(status);
  });

  test('counts a status it cannot ask for as no NFC', async () => {
    native({
      status: jest.fn(async () => {
        throw new Error('gone');
      }),
    });
    await expect(tapReader()!.status()).resolves.toBe('missing');
  });
});

describe('a read', () => {
  test("hands back the tag's records, and nothing native added to them", async () => {
    const record = uriRecord('lightning:LNBC1INVOICE');
    const stub = native({
      read: jest.fn(async () => [{ ...record, id: 'AAEC', extra: true }]),
    });
    await expect(tapReader()!.read('Hold near')).resolves.toEqual([record]);
    expect(stub.read).toHaveBeenCalledWith('Hold near');
  });

  test.each([
    ['nothing', undefined],
    ['something that is not a list', { records: [] }],
    ['a record with no payload', [{ tnf: 1, type: 'VQ==' }]],
    ['a record whose type is not text', [{ tnf: 1, type: 85, payload: '' }]],
    ['a hole where a record should be', [null]],
  ])('that hands back %s is a failed read', async (_, answer) => {
    native({ read: jest.fn(async () => answer) });
    await expect(tapReader()!.read('')).rejects.toMatchObject({
      code: 'TAP_FAILED',
    });
  });

  test.each([
    'TAP_CANCELLED',
    'TAP_TIMEOUT',
    'TAP_NO_NDEF',
    'TAP_TOO_LARGE',
    'TAP_FAILED',
  ] as const)('that ends with %s says so', async code => {
    native({
      read: jest.fn(async () => {
        throw coded(code);
      }),
    });
    const failure = await tapReader()!
      .read('')
      .catch(error => error);
    expect(failure).toBeInstanceOf(TapError);
    expect(failure.code).toBe(code);
  });

  test('that ends any other way is a failed read', async () => {
    native({
      read: jest.fn(async () => {
        throw coded('EUNSPECIFIED');
      }),
    });
    await expect(tapReader()!.read('')).rejects.toMatchObject({
      code: 'TAP_FAILED',
    });
    expect(tapCode(new Error('no code'))).toBe('TAP_FAILED');
    expect(tapCode(null)).toBe('TAP_FAILED');
    expect(tapCode('TAP_TIMEOUT')).toBe('TAP_FAILED');
    expect(tapCode(new TapError('TAP_TIMEOUT'))).toBe('TAP_TIMEOUT');
  });
});

describe("the iPhone's sheet", () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.useFakeTimers();
  });

  test('is ended by the deadline, and the native read with it', async () => {
    const stub = native();
    const read = tapReader()!
      .read('')
      .catch(error => error);
    jest.advanceTimersByTime(TAP_DEADLINE_MS - 1);
    expect(stub.cancel).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(stub.cancel).toHaveBeenCalledTimes(1);
    expect(await read).toMatchObject({ code: 'TAP_TIMEOUT' });
  });

  test('that answers in time leaves no deadline behind', async () => {
    const stub = native({ read: jest.fn(async () => []) });
    await expect(tapReader()!.read('')).resolves.toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(TAP_DEADLINE_MS * 2);
    expect(stub.cancel).not.toHaveBeenCalled();
  });

  test('comes down before the app lock would count the wait as time away', () => {
    // The lock is not this feature's to change (REDESIGN.md rule 8), so its
    // grace is read from where it is written.
    const lock = fs.readFileSync(
      path.join(ROOT, 'src', 'services', 'useAppLock.ts'),
      'utf8',
    );
    const grace = Number(
      /BACKGROUND_GRACE_MS\s*=\s*([\d_]+)/.exec(lock)?.[1].replace(/_/g, ''),
    );
    expect(grace).toBeGreaterThan(0);
    // With room for the sheet to leave and the app to come back to the front.
    expect(TAP_DEADLINE_MS).toBeLessThanOrEqual(grace - 5000);
    // And inside the 60 seconds iOS gives a session.
    expect(TAP_DEADLINE_MS).toBeLessThan(60_000);
  });

  test('in a build with no right to read tags is no NFC from then on', async () => {
    const stub = native({
      read: jest.fn(async () => {
        throw coded('TAP_UNAVAILABLE');
      }),
    });
    const reader = tapReader()!;
    await expect(reader.status()).resolves.toBe('ready');
    await expect(reader.read('')).rejects.toMatchObject({ code: 'TAP_FAILED' });
    await expect(reader.status()).resolves.toBe('missing');
    expect(stub.status).toHaveBeenCalledTimes(1);
  });
});

describe('listening on Android', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.useFakeTimers();
  });

  test('has no deadline: it lasts as long as the scan is open', async () => {
    const stub = native();
    let settled = false;
    tapReader()!
      .read('')
      .then(
        () => (settled = true),
        () => (settled = true),
      );
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(10 * 60_000);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(stub.cancel).not.toHaveBeenCalled();
  });
});

describe('calling a read off', () => {
  test('tells the native module', async () => {
    const stub = native();
    await tapReader()!.cancel();
    expect(stub.cancel).toHaveBeenCalledTimes(1);
  });

  test('is safe when nothing was reading, or the module has gone', async () => {
    native({
      cancel: jest.fn(async () => {
        throw new Error('gone');
      }),
    });
    await expect(tapReader()!.cancel()).resolves.toBeUndefined();
  });
});

describe('the way to the NFC settings', () => {
  test("on Android is the system's own NFC screen", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const intent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    native();
    await tapReader()!.openSettings();
    expect(intent).toHaveBeenCalledWith('android.settings.NFC_SETTINGS');
    expect(settings).not.toHaveBeenCalled();
  });

  test("falls back to the app's settings on a phone without that screen", async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Linking, 'sendIntent').mockRejectedValue(new Error('none'));
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    native();
    await tapReader()!.openSettings();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  test("on an iPhone is the app's settings, and never fails", async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const intent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue();
    const settings = jest
      .spyOn(Linking, 'openSettings')
      .mockRejectedValue(new Error('none'));
    native();
    await expect(tapReader()!.openSettings()).resolves.toBeUndefined();
    expect(intent).not.toHaveBeenCalled();
    expect(settings).toHaveBeenCalledTimes(1);
  });
});
