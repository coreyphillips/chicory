import * as Keychain from 'react-native-keychain';
import {
  AUTO_PAY_OFF,
  autoPayNow,
  loadAutoPayPreference,
  parseAutoPay,
  setAutoPayPreference,
  snapShare,
} from '../src/services/autoPayPreference';

/**
 * Settings > Auto-pay's preference: off at 50% unless saved otherwise, read
 * leniently, saved before it is applied, and the one value every reader
 * shares.
 */
const SERVICE = 'com.beignet.wallet.auto-pay';
const read = jest.mocked(Keychain.getGenericPassword);
const write = jest.mocked(Keychain.setGenericPassword);

afterEach(async () => {
  read.mockReset();
  read.mockResolvedValue(false);
  write.mockReset();
  write.mockResolvedValue({ service: 'test', storage: 'keychain' } as never);
  await setAutoPayPreference(AUTO_PAY_OFF);
  write.mockClear();
});

describe('reading what is saved', () => {
  it.each([
    [null, { on: false, share: 50 }],
    ['', { on: false, share: 50 }],
    ['{"on":true,"share":35}', { on: true, share: 35 }],
    ['{"on":true,"share":35,"tapToPay":"yes"}', { on: true, share: 35 }],
    ['{"on":false,"share":80}', { on: false, share: 80 }],
    ['{"on":"yes","share":35}', { on: false, share: 35 }],
    ['{"on":true,"share":33}', { on: true, share: 35 }],
    ['{"on":true,"share":140}', { on: true, share: 100 }],
    ['{"on":true,"share":-4}', { on: true, share: 0 }],
    ['{"on":true}', { on: true, share: 50 }],
    ['{"on":true,"share":"40"}', { on: true, share: 50 }],
    ['on', { on: false, share: 50 }],
    ['[]', { on: false, share: 50 }],
    ['null', { on: false, share: 50 }],
  ])('%j reads as %j', (saved, expected) => {
    expect(parseAutoPay(saved)).toEqual({ ...expected, tapToPay: false });
  });

  it('snaps a share to its 5% detent within 0 to 100', () => {
    expect(snapShare(52)).toBe(50);
    expect(snapShare(53)).toBe(55);
    expect(snapShare(Number.POSITIVE_INFINITY)).toBe(50);
    expect(snapShare(undefined)).toBe(50);
  });
});

describe('the preference every reader shares', () => {
  it('is off until the store answers, and off when nothing is saved', async () => {
    expect(autoPayNow()).toEqual({ on: false, share: 50, tapToPay: false });
    await expect(loadAutoPayPreference()).resolves.toEqual({
      on: false,
      share: 50,
      tapToPay: false,
    });
    expect(read).toHaveBeenCalledWith({ service: SERVICE });
  });

  it('restores the saved share and tap-to-pay opt-in', async () => {
    read.mockResolvedValueOnce({
      service: SERVICE,
      username: 'beignet-auto-pay',
      password: '{"on":true,"share":65,"tapToPay":true}',
      storage: 'keychain',
    } as never);
    await loadAutoPayPreference();
    expect(autoPayNow()).toEqual({ on: true, share: 65, tapToPay: true });
  });

  it('reads an unreadable store as off', async () => {
    read.mockRejectedValueOnce(new Error('locked'));
    await loadAutoPayPreference();
    expect(autoPayNow()).toEqual({ on: false, share: 50, tapToPay: false });
  });

  it('keeps overlapping tap-to-pay and limit edits in order', async () => {
    await setAutoPayPreference({ on: true, share: 65, tapToPay: true });
    write.mockClear();
    let finishWrite!: (result: Keychain.Result) => void;
    write.mockReturnValueOnce(
      new Promise(resolve => {
        finishWrite = resolve;
      }),
    );
    const optOut = setAutoPayPreference({ tapToPay: false });
    const limit = setAutoPayPreference({ share: 20 });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    finishWrite({
      service: SERVICE,
      storage: 'keychain' as Keychain.STORAGE_TYPE,
    });
    await Promise.all([optOut, limit]);
    expect(write.mock.calls.map(([, value]) => JSON.parse(value))).toEqual([
      { on: true, share: 65, tapToPay: false },
      { on: true, share: 20, tapToPay: false },
    ]);
    expect(autoPayNow()).toEqual({ on: true, share: 20, tapToPay: false });
  });

  it('saves on this device only, then applies it', async () => {
    await setAutoPayPreference({ on: true, share: 42, tapToPay: true });
    expect(write).toHaveBeenCalledWith(
      'beignet-auto-pay',
      '{"on":true,"share":40,"tapToPay":true}',
      { service: SERVICE, accessible: 'WhenUnlockedThisDeviceOnly' },
    );
    expect(autoPayNow()).toEqual({ on: true, share: 40, tapToPay: true });
  });

  it('changes nothing when the save fails', async () => {
    await setAutoPayPreference({ on: true, share: 30, tapToPay: false });
    write.mockResolvedValueOnce(false);
    await expect(
      setAutoPayPreference({ on: false, share: 30, tapToPay: false }),
    ).rejects.toThrow('Could not save the auto-pay setting.');
    expect(autoPayNow()).toEqual({ on: true, share: 30, tapToPay: false });
    write.mockRejectedValueOnce(new Error('denied'));
    await expect(
      setAutoPayPreference({ on: true, share: 90, tapToPay: true }),
    ).rejects.toThrow('denied');
    expect(autoPayNow()).toEqual({ on: true, share: 30, tapToPay: false });
  });
});
