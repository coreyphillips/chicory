import React from 'react';
import { Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { Activity, WalletSnapshot } from '@beignet/wallet-core';
import {
  ActivityScreen,
  DetailScreen,
  HomeScreen,
  activityStatus,
} from '../src/screens/Wallet';
import { copy } from '../src/design/copy';
import { chipText } from '../src/glyphs/CopyChip';
import { useNow } from '../src/services/clock';
import { copyViolations } from '../test-support/copyGuard';
import { mount } from '../test-support/guard';
import { allText, meaning, press, visibleText } from '../test-support/query';

const activity = (over: Partial<Activity> & { id: string }): Activity => ({
  kind: 'sent',
  title: 'Payment',
  description: '',
  amountSats: 1000,
  feeSats: 1,
  status: 'completed',
  timestamp: Date.parse('2026-06-06T12:00:00Z'),
  reference: '',
  ...over,
});

const rows: Activity[] = [
  activity({ id: 'a', title: 'Coffee', kind: 'sent', amountSats: 4200 }),
  activity({
    id: 'b',
    title: 'Salary',
    kind: 'received',
    amountSats: 250000,
    timestamp: Date.parse('2026-06-05T09:00:00Z'),
  }),
  activity({
    id: 'c',
    title: 'Invoice for Dana',
    kind: 'request',
    status: 'pending',
    amountSats: 7000,
    timestamp: Date.parse('2026-06-04T09:00:00Z'),
  }),
  activity({
    id: 'd',
    title: 'Paid request',
    kind: 'received',
    amountSats: 300,
    reference: 'lnbc-reference',
    timestamp: Date.parse('2026-06-03T09:00:00Z'),
    receiveRequest: {
      id: 'r',
      uri: 'bitcoin:x',
      bolt11: 'lnbc',
      paymentHash: 'h',
      amountSats: 300,
      description: '',
      feeSats: 0,
      expiresAt: 0,
      warnings: [],
      demo: false,
    },
  }),
];

const snapshot: WalletSnapshot = {
  wallet: { id: 'w', name: 'Everyday', network: 'regtest', status: 'running' },
  balance: {
    totalSats: 261500,
    availableSats: 250000,
    pendingSats: 11500,
    receivableSats: 100000,
  },
  activity: rows,
  primary: { uri: 'node', connected: true, setup: 'ready' },
  notes: [],
  updatedAt: Date.now(),
  demo: false,
};

function strings(children: unknown, out: string[] = []): string[] {
  if (typeof children === 'string' || typeof children === 'number')
    out.push(String(children));
  else if (Array.isArray(children))
    children.forEach(child => strings(child, out));
  else if (children && typeof children === 'object')
    strings(
      (children as { props?: { children?: unknown } }).props?.children,
      out,
    );
  return out;
}
const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .flatMap(node => strings(node.props.children))
    .join(' | ');
/** The rendered host node, which is where accessibilityState actually lands. */
const state = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .find(node => !!node.props.accessibilityState)!;

async function renderActivity(props: Record<string, unknown> = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ActivityScreen
        snapshot={snapshot}
        onDetail={jest.fn()}
        filter="All"
        onFilter={jest.fn()}
        query=""
        onQuery={jest.fn()}
        {...props}
      />,
    );
  });
  return tree;
}

// A row's title is the engine's words, so it reaches a screen reader only.
test('search matches title, reference and amount', async () => {
  let tree = await renderActivity({ query: 'salary' });
  expect(meaning(tree)).toContain('Salary');
  expect(meaning(tree)).not.toContain('Coffee');
  await act(async () => tree.unmount());

  tree = await renderActivity({ query: 'lnbc-reference' });
  expect(meaning(tree)).toContain('Paid request');
  expect(meaning(tree)).not.toContain('Coffee');
  await act(async () => tree.unmount());

  tree = await renderActivity({ query: '4200' });
  expect(meaning(tree)).toContain('Coffee');
  expect(meaning(tree)).not.toContain('Salary');
  await act(async () => tree.unmount());

  tree = await renderActivity({ query: 'nothing here' });
  expect(meaning(tree)).toContain('No payments match “nothing here”.');
  await act(async () => tree.unmount());
});

test('the Requests filter keeps a request that has since been paid', async () => {
  const tree = await renderActivity({ filter: 'Requests' });
  expect(meaning(tree)).toContain('Invoice for Dana');
  // 'Paid request' is a received payment now, but it is still the code the
  // user sent someone, which is how they will look for it.
  expect(meaning(tree)).toContain('Paid request');
  expect(meaning(tree)).not.toContain('Coffee');
  await act(async () => tree.unmount());
});

test('rows are grouped under day headers', async () => {
  const tree = await renderActivity();
  expect(text(tree)).toContain('June 6');
  expect(text(tree)).toContain('June 5');
  await act(async () => tree.unmount());
});

test('hiding the balance masks the total, the available line and every row amount', async () => {
  // The rows Home once previewed are the sheet's, so both are drawn here, as
  // they sit together at home.
  const tree = await mount(
    <>
      <HomeScreen
        snapshot={snapshot}
        hidden
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
      />
      <ActivityScreen
        snapshot={snapshot}
        hidden
        onDetail={jest.fn()}
        filter="All"
        onFilter={jest.fn()}
        query=""
        onQuery={jest.fn()}
      />
    </>,
  );
  expect(visibleText(tree)).toContain('••••••');
  // Not on screen, and not to a screen reader either.
  const everything = allText(tree);
  for (const figure of ['261,500', '250,000', '11,500', '4,200']) {
    expect(everything).not.toContain(figure);
  }
  expect(meaning(tree)).toContain(copy.home.balanceHidden);
  const labels = tree.root
    .findByType(ActivityScreen)
    .findAllByProps({ accessibilityRole: 'button' })
    .map(node => String(node.props.accessibilityLabel ?? ''));
  expect(labels.join(' | ')).toMatch(/amount hidden/i);
  await act(async () => tree.unmount());
});

test('a stale snapshot blocks send and receive and says why', async () => {
  const onSend = jest.fn();
  const onReceive = jest.fn();
  const onScan = jest.fn();
  const onRefresh = jest.fn();
  const tree = await mount(
    <HomeScreen
      snapshot={{ ...snapshot, updatedAt: Date.now() - 120000 }}
      stale
      onSend={onSend}
      onReceive={onReceive}
      onScan={onScan}
      onActivity={jest.fn()}
      onDetail={jest.fn()}
      onRefresh={onRefresh}
    />,
  );
  // The gate is the whole message. Figures this old are not spendable, and the
  // app is already recovering on its own, so there is nothing to ask for.
  expect(meaning(tree)).not.toContain('Pull to refresh');
  for (const label of ['Send', 'Receive', 'Scan a payment request']) {
    const control = state(tree, label);
    expect(control.props.accessibilityState.disabled).toBe(true);
    expect(control.props.accessibilityValue).toEqual({
      text: copy.health.stale,
    });
  }
  // A tap on a gated action refreshes instead of acting.
  for (const label of ['Send', 'Receive', 'Scan a payment request']) {
    await press(tree, label);
  }
  expect(onRefresh).toHaveBeenCalledTimes(3);
  expect(onSend).not.toHaveBeenCalled();
  expect(onReceive).not.toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
  await act(async () => tree.unmount());
});

test('payment details keep a hidden balance hidden and follow the unit', async () => {
  const item = { ...rows[0], txid: 'abc123txid' };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<DetailScreen item={item} hidden />);
  });
  let rendered = text(tree);
  expect(rendered).toContain('••••••');
  expect(rendered).not.toContain('4,200');
  expect(meaning(tree)).not.toContain('4,200');
  // A reference is not an amount; it stays readable, in groups of four,
  // and copies whole.
  expect(rendered).toContain(chipText('abc123txid'));
  expect(meaning(tree)).toContain('abc123txid');
  await act(async () => tree.unmount());
  await act(async () => {
    tree = create(<DetailScreen item={item} unit="btc" />);
  });
  rendered = text(tree);
  expect(rendered).toContain('BTC');
  expect(rendered).not.toContain('4,200 sats');
  await act(async () => tree.unmount());
});

test('payment outcomes are labelled in words, never the raw status', () => {
  expect(activityStatus(activity({ id: 'x', status: 'uncertain' }))).toBe(
    'Needs checking',
  );
  expect(activityStatus(activity({ id: 'y', status: 'completed' }))).toBe(
    'Completed',
  );
  expect(activityStatus(activity({ id: 'z', status: 'expired' }))).toBe(
    'Expired',
  );
});

test('the shared clock ticks only while enabled', async () => {
  jest.useFakeTimers();
  const Probe = ({ enabled }: { enabled: boolean }) => (
    <Text>{useNow(1000, enabled)}</Text>
  );
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<Probe enabled={false} />);
  });
  const paused = text(tree);
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(text(tree)).toBe(paused);
  // Whatever the renderer keeps scheduled on its own is the baseline.
  const idle = jest.getTimerCount();
  await act(async () => {
    tree.update(<Probe enabled />);
  });
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(text(tree)).not.toBe(paused);
  // One interval, and nothing else, is what enabling added.
  expect(jest.getTimerCount()).toBe(idle + 1);
  await act(async () => tree.unmount());
  jest.useRealTimers();
});

test('money on its way sits under the balance, not in a paragraph above the buttons', async () => {
  const shown = {
    ...snapshot,
    balance: { ...snapshot.balance, pendingSats: 30000 },
    notes: [
      '30,000 sats confirmed. Moving them failed. peer disconnected. Retrying.',
    ],
  };
  const tree = await mount(
    <HomeScreen
      snapshot={shown}
      onSend={jest.fn()}
      onReceive={jest.fn()}
      onActivity={jest.fn()}
      onDetail={jest.fn()}
    />,
  );
  // One line, beside the amount that is already spendable, because that is the
  // same question asked twice.
  const said = meaning(tree);
  expect(said).toContain('250,000 sats ready to send, 30,000 sats arriving');
  // The engine's running commentary is not the wallet page's job. It was
  // paragraphs of it, above the Send button, saying what Activity already says.
  expect(said).not.toContain('Moving them failed');
  expect(said).not.toContain('Available when the transfer confirms');
  expect(said).not.toContain('has not confirmed yet');
  // Nor is any other sentence: the page shows figures and nothing else.
  expect(copyViolations(tree, { data: [] })).toEqual([]);
  await act(async () => tree.unmount());
});

test('a wallet with nothing in flight shows no arriving line at all', async () => {
  const tree = await mount(
    <HomeScreen
      snapshot={{
        ...snapshot,
        balance: { ...snapshot.balance, pendingSats: 0 },
      }}
      onSend={jest.fn()}
      onReceive={jest.fn()}
      onActivity={jest.fn()}
      onDetail={jest.fn()}
    />,
  );
  expect(allText(tree)).not.toContain('arriving');
  expect(meaning(tree)).toContain('250,000 sats ready to send');
  await act(async () => tree.unmount());
});
