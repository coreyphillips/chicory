import React from 'react';
import { Linking, Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { normalizePaymentLink, usePaymentLinks } from '../src/services/links';

describe('payment links', () => {
  test('a bitcoin: link is passed through for review, unchanged', () => {
    const uri = 'bitcoin:bcrt1qexample?amount=0.0001&lightning=lnbcrt1invoice';
    expect(normalizePaymentLink(uri)).toBe(uri);
  });

  test('a lightning: link loses only its scheme, because the parser reads the invoice', () => {
    expect(normalizePaymentLink('lightning:lnbc1invoice')).toBe('lnbc1invoice');
    expect(normalizePaymentLink('LIGHTNING:lnbc1invoice')).toBe('lnbc1invoice');
  });

  test('surrounding whitespace from a shared link is trimmed', () => {
    expect(normalizePaymentLink('  bitcoin:addr  ')).toBe('bitcoin:addr');
  });

  test('any other scheme is refused, so an arbitrary link cannot reach Send', () => {
    for (const value of [
      'https://example.com/pay',
      'file:///etc/passwd',
      // eslint-disable-next-line no-script-url
      'javascript:alert(1)',
      'beignet://send?to=me',
      'bitcoincash:qexample',
      '',
      null,
      undefined,
    ])
      expect(normalizePaymentLink(value as string)).toBe('');
  });
});

describe('the launch link', () => {
  test('is read once per process, not again when the wallet is reopened', async () => {
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('lightning:lnbc-launch');
    const listen = jest
      .spyOn(Linking, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    const onRequest = jest.fn();
    const Probe = ({ ready }: { ready: boolean }) => {
      usePaymentLinks(ready, onRequest);
      return null;
    };
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Probe, { ready: true }));
    });
    expect(onRequest).toHaveBeenCalledWith('lnbc-launch');
    // A network switch or wallet change flips readiness off and on again.
    await act(async () => {
      tree.update(React.createElement(Probe, { ready: false }));
    });
    await act(async () => {
      tree.update(React.createElement(Probe, { ready: true }));
    });
    expect(initial).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    // Links that arrive while the app is open still reach Send.
    expect(listen).toHaveBeenCalledTimes(2);
    await act(async () => tree.unmount());
    initial.mockRestore();
    listen.mockRestore();
  });
});

describe('the launch link of an app that outlives its activity', () => {
  // On Android 7 to 11, Back at Home closes the activity and leaves the app
  // running. The tap or link that comes next makes a new activity, and the
  // running app is told of nothing: the request is that activity's launch
  // URL. React Native mounts the app again for it (docs/TAP-TO-PAY.md).
  const Probe = ({ ready, to }: { ready: boolean; to: jest.Mock }) => {
    usePaymentLinks(ready, to);
    return null;
  };
  const mount = async (to: jest.Mock) => {
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Probe, { ready: true, to }));
    });
    return tree;
  };

  // React Native's Jest setup makes Linking's methods mocks already, which
  // keep their calls from one test to the next.
  beforeEach(() => jest.mocked(Linking.getInitialURL).mockClear());
  afterEach(() => jest.restoreAllMocks());

  test('is read by each mount on Android, and once while the app stays mounted', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest
      .spyOn(Linking, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('lightning:LNBC-FIRST');
    const onRequest = jest.fn();
    const first = await mount(onRequest);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenLastCalledWith('LNBC-FIRST');
    // A network switch or a wallet change does not read it again.
    await act(async () => {
      first.update(React.createElement(Probe, { ready: false, to: onRequest }));
    });
    await act(async () => {
      first.update(React.createElement(Probe, { ready: true, to: onRequest }));
    });
    expect(initial).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);

    // Back closes the activity, and the app with it. A tap makes another.
    await act(async () => first.unmount());
    initial.mockResolvedValue('bitcoin:?LIGHTNING=LNBC-SECOND');
    const second = await mount(onRequest);
    expect(initial).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenCalledTimes(2);
    expect(onRequest).toHaveBeenLastCalledWith(
      'bitcoin:?LIGHTNING=LNBC-SECOND',
    );

    // An activity opened from the launcher holds no request.
    await act(async () => second.unmount());
    initial.mockResolvedValue(null);
    const third = await mount(onRequest);
    expect(initial).toHaveBeenCalledTimes(3);
    expect(onRequest).toHaveBeenCalledTimes(2);
    await act(async () => third.unmount());
  });

  test('is read once for the process on an iPhone, which keeps the URL it was launched with', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest
      .spyOn(Linking, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as never);
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('lightning:lnbc-launch');
    const onRequest = jest.fn();
    // The suite above has read it for this process already.
    const first = await mount(onRequest);
    await act(async () => first.unmount());
    const second = await mount(onRequest);
    expect(initial).not.toHaveBeenCalled();
    expect(onRequest).not.toHaveBeenCalled();
    await act(async () => second.unmount());
  });
});

describe('a request read from an NFC tag', () => {
  // Android hands a tapped tag's URI record to Linking as it hands a link
  // (docs/TAP-TO-PAY.md), with the scheme in lower case whatever the tag
  // wrote and the rest as written.
  test.each([
    [
      'a till presenting lightning: and its invoice in capitals',
      'lightning:LNBC1INVOICE',
      'LNBC1INVOICE',
    ],
    [
      'the BIP 321 form',
      'bitcoin:?lightning=LNBC1INVOICE',
      'bitcoin:?lightning=LNBC1INVOICE',
    ],
    [
      'the BIP 321 form with its field name in capitals',
      'bitcoin:?LIGHTNING=LNBC1INVOICE',
      'bitcoin:?LIGHTNING=LNBC1INVOICE',
    ],
  ])('reaches Send as a link does: %s', async (_, url, request) => {
    const initial = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(null);
    let deliver: (event: { url: string }) => void = () => {};
    const listen = jest.spyOn(Linking, 'addEventListener').mockImplementation(((
      _type: string,
      handler: typeof deliver,
    ) => {
      deliver = handler;
      return { remove: jest.fn() };
    }) as never);
    const onRequest = jest.fn();
    const Probe = () => {
      usePaymentLinks(true, onRequest);
      return null;
    };
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(React.createElement(Probe));
    });
    act(() => deliver({ url }));
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith(request);
    await act(async () => tree.unmount());
    initial.mockRestore();
    listen.mockRestore();
  });
});
