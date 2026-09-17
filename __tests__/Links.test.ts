import React from 'react';
import { Linking } from 'react-native';
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
