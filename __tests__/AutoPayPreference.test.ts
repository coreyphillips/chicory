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
    expect(parseAutoPay(saved)).toEqual(expected);
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
    expect(autoPayNow()).toEqual({ on: false, share: 50 });
    await expect(loadAutoPayPreference()).resolves.toEqual({
      on: false,
      share: 50,
    });
    expect(read).toHaveBeenCalledWith({ service: SERVICE });
  });

  it('takes what is saved once it is read', async () => {
    read.mockResolvedValueOnce({
      service: SERVICE,
      username: 'beignet-auto-pay',
      password: '{"on":true,"share":65}',
      storage: 'keychain',
    } as never);
    await loadAutoPayPreference();
    expect(autoPayNow()).toEqual({ on: true, share: 65 });
  });

  it('reads an unreadable store as off', async () => {
    read.mockRejectedValueOnce(new Error('locked'));
    await loadAutoPayPreference();
    expect(autoPayNow()).toEqual({ on: false, share: 50 });
  });

  it('saves on this device only, then applies it', async () => {
    await setAutoPayPreference({ on: true, share: 42 });
    expect(write).toHaveBeenCalledWith(
      'beignet-auto-pay',
      '{"on":true,"share":40}',
      { service: SERVICE, accessible: 'WhenUnlockedThisDeviceOnly' },
    );
    expect(autoPayNow()).toEqual({ on: true, share: 40 });
  });

  it('changes nothing when the save fails', async () => {
    await setAutoPayPreference({ on: true, share: 30 });
    write.mockResolvedValueOnce(false);
    await expect(
      setAutoPayPreference({ on: false, share: 30 }),
    ).rejects.toThrow('Could not save the auto-pay setting.');
    expect(autoPayNow()).toEqual({ on: true, share: 30 });
    write.mockRejectedValueOnce(new Error('denied'));
    await expect(setAutoPayPreference({ on: true, share: 90 })).rejects.toThrow(
      'denied',
    );
    expect(autoPayNow()).toEqual({ on: true, share: 30 });
  });
});
