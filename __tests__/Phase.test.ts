import { backupPending, derivePhase, phaseInput } from '../src/stage/phase';
import type { Phase, PhaseInput } from '../src/stage/phase';

/** A wallet open with live figures, so every earlier rung is false. */
const LIVE: PhaseInput = {
  locked: false,
  prompting: false,
  lockError: '',
  switching: false,
  closing: false,
  erasing: false,
  switchTarget: null,
  initializing: false,
  connecting: false,
  hasClient: true,
  deviceHint: true,
  deviceVisible: false,
  walletId: 'w1',
  hasSnapshot: true,
  error: '',
  switchError: '',
};

/** Nothing open and nothing on the device yet. */
const FIRST_RUN: Partial<PhaseInput> = {
  hasClient: false,
  deviceHint: false,
  walletId: '',
  hasSnapshot: false,
};

const phase = (patch: Partial<PhaseInput>) =>
  derivePhase({ ...LIVE, ...patch });

describe('each rung of the ladder', () => {
  test.each<[string, Partial<PhaseInput>, Phase]>([
    [
      'the lock is closed',
      {
        locked: true,
        prompting: true,
        lockError: 'Chicory stays locked until this is confirmed.',
      },
      {
        kind: 'locked',
        prompting: true,
        error: 'Chicory stays locked until this is confirmed.',
      },
    ],
    [
      'a network switch',
      { switching: true, switchTarget: 'regtest' },
      { kind: 'transit', why: 'switching', target: 'regtest' },
    ],
    [
      'a close',
      { closing: true },
      { kind: 'transit', why: 'closing', target: null },
    ],
    [
      'an erase, which closes as it goes',
      { closing: true, erasing: true },
      { kind: 'transit', why: 'erasing', target: null },
    ],
    ['the launch restore', { initializing: true }, { kind: 'opening' }],
    [
      'a device wallet that could not be opened',
      {
        hasClient: false,
        walletId: '',
        hasSnapshot: false,
        error: 'open failed',
        switchError: 'switch failed',
      },
      { kind: 'saved', error: 'switch failed' },
    ],
    [
      'a first run',
      { ...FIRST_RUN, connecting: true, error: 'no engine' },
      { kind: 'welcome', opening: true, device: false, error: 'no engine' },
    ],
    [
      'an open device with no wallet chosen',
      { walletId: '', hasSnapshot: false, error: 'create failed' },
      { kind: 'picker', error: 'create failed' },
    ],
    [
      'a chosen wallet whose engine is starting',
      { hasSnapshot: false },
      { kind: 'loading' },
    ],
    [
      'a chosen wallet whose engine did not answer',
      { hasSnapshot: false, error: 'PRIMARY_DOWN' },
      { kind: 'offline', error: 'PRIMARY_DOWN' },
    ],
    ['a wallet with figures', {}, { kind: 'wallet', error: '' }],
  ])('%s', (_name, patch, expected) => {
    expect(phase(patch)).toEqual(expected);
  });
});

describe('precedence', () => {
  test('the lock beats a transit and everything under it', () => {
    expect(
      phase({
        ...FIRST_RUN,
        locked: true,
        switching: true,
        closing: true,
        erasing: true,
        initializing: true,
        error: 'boom',
      }).kind,
    ).toBe('locked');
  });

  test.each<[string, Partial<PhaseInput>]>([
    ['switching', { switching: true }],
    ['closing', { closing: true }],
  ])(
    '%s beats opening, saved, welcome, picker, loading and offline',
    (_name, transit) => {
      for (const below of [
        { initializing: true },
        { hasClient: false, deviceHint: true },
        FIRST_RUN,
        { walletId: '' },
        { hasSnapshot: false },
        { hasSnapshot: false, error: 'boom' },
      ])
        expect(phase({ ...below, ...transit }).kind).toBe('transit');
    },
  );

  test('the launch restore is waited out before asking what is on the device', () => {
    expect(phase({ ...FIRST_RUN, initializing: true }).kind).toBe('opening');
    expect(phase({ hasClient: false, initializing: true }).kind).toBe(
      'opening',
    );
  });

  test('a returning device wallet never lands on welcome unless device setup is open', () => {
    const returning = { ...FIRST_RUN, deviceHint: true };
    expect(phase(returning).kind).toBe('saved');
    expect(phase({ ...returning, error: 'boom' }).kind).toBe('saved');
    expect(phase({ ...returning, connecting: true }).kind).toBe('saved');
    expect(phase({ ...returning, deviceVisible: true })).toEqual({
      kind: 'welcome',
      opening: false,
      device: true,
      error: '',
    });
  });

  test('a saved phase reports the open error when no switch failed', () => {
    expect(
      phase({ ...FIRST_RUN, deviceHint: true, error: 'open failed' }),
    ).toEqual({ kind: 'saved', error: 'open failed' });
  });

  test('loading and offline are told apart by the session error alone', () => {
    expect(phase({ hasSnapshot: false }).kind).toBe('loading');
    expect(phase({ hasSnapshot: false, switchError: 'switch failed' })).toEqual(
      { kind: 'loading' },
    );
    expect(phase({ hasSnapshot: false, error: 'boom' }).kind).toBe('offline');
    expect(
      phase({
        hasSnapshot: false,
        error: 'boom',
        switchError: 'switch failed',
      }),
    ).toEqual({ kind: 'offline', error: 'switch failed' });
  });

  test('a failed refresh keeps the wallet on screen', () => {
    expect(phase({ error: 'refresh failed' })).toEqual({
      kind: 'wallet',
      error: 'refresh failed',
    });
  });
});

describe('phaseInput', () => {
  const lock = { locked: false, prompting: false, error: '' };
  const session = {
    switching: false,
    closing: false,
    erasing: false,
    switchTarget: null,
    initializing: false,
    connecting: false,
    client: null,
    deviceHint: false,
    deviceVisible: false,
    walletId: '',
    snapshot: null,
    error: '',
    switchError: '',
  };

  test('reduces the client and snapshot to whether they exist', () => {
    const input = phaseInput(lock, {
      ...session,
      client: {} as never,
      walletId: 'w1',
      snapshot: {} as never,
    });
    expect(input.hasClient).toBe(true);
    expect(input.hasSnapshot).toBe(true);
    expect(input.walletId).toBe('w1');
    expect(derivePhase(input).kind).toBe('wallet');
  });

  test('carries the lock state and its error', () => {
    const input = phaseInput(
      {
        locked: true,
        prompting: true,
        error: 'Chicory stays locked until this is confirmed.',
      },
      session,
    );
    expect(derivePhase(input)).toEqual({
      kind: 'locked',
      prompting: true,
      error: 'Chicory stays locked until this is confirmed.',
    });
  });

  test('carries the switch target into the transit', () => {
    const input = phaseInput(lock, {
      ...session,
      client: {} as never,
      switching: true,
      switchTarget: 'testnet',
    });
    expect(derivePhase(input)).toEqual({
      kind: 'transit',
      why: 'switching',
      target: 'testnet',
    });
  });
});

describe('backupPending', () => {
  type Session = Parameters<typeof backupPending>[0];
  const pending: Session = {
    client: {} as never,
    rememberedSession: {
      mode: 'device',
      network: 'regtest',
      locked: false,
      backupPending: true,
    },
    closing: false,
    switching: false,
  };

  test('holds while a wallet is open and its phrase is unsaved', () => {
    expect(backupPending(pending)).toBe(true);
  });

  test.each<[string, Partial<Session>]>([
    ['no wallet is open', { client: null }],
    ['nothing is remembered', { rememberedSession: null }],
    [
      'the phrase was saved',
      {
        rememberedSession: {
          mode: 'device',
          network: 'regtest',
          locked: false,
          backupPending: false,
        },
      },
    ],
    ['the wallet is closing', { closing: true }],
    ['the wallet is switching', { switching: true }],
  ])('drops away when %s', (_name, patch) => {
    expect(backupPending({ ...pending, ...patch })).toBe(false);
  });
});
