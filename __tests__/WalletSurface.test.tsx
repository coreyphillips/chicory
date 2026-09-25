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
import { useNow } from '../src/services/clock';
import { meaning } from '../test-support/query';

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
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <HomeScreen
        snapshot={snapshot}
        hidden
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
      />,
    );
  });
  const rendered = text(tree);
  expect(rendered).toContain('••••••');
  expect(rendered).not.toContain('261,500');
  expect(rendered).not.toContain('250,000');
  expect(rendered).not.toContain('4,200');
  // The screen reader must not announce what the screen is hiding.
  const labels = tree.root
    .findAllByProps({ accessibilityRole: 'button' })
    .map(node => String(node.props.accessibilityLabel ?? ''));
  expect(labels.join(' | ')).toContain('amount hidden');
  expect(labels.join(' | ')).not.toContain('250,000');
  await act(async () => tree.unmount());
});

test('a stale snapshot blocks send and receive and says why', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <HomeScreen
        snapshot={{ ...snapshot, updatedAt: Date.now() - 120000 }}
        stale
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onScan={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
      />,
    );
  });
  // The gate is the whole message. Figures this old are not spendable, and the
  // app is already recovering on its own, so there is nothing to ask for.
  expect(text(tree)).not.toContain('Pull to refresh');
  expect(state(tree, 'Send').props.accessibilityState.disabled).toBe(true);
  expect(state(tree, 'Receive').props.accessibilityState.disabled).toBe(true);
  expect(
    state(tree, 'Scan a payment request').props.accessibilityState.disabled,
  ).toBe(true);
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
  // A reference is not an amount; it stays readable, and copies whole.
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
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <HomeScreen
        snapshot={{
          ...snapshot,
          balance: { ...snapshot.balance, pendingSats: 30000 },
          notes: [
            '30,000 sats confirmed. Moving them failed. peer disconnected. Retrying.',
          ],
        }}
        onSend={jest.fn()}
        onReceive={jest.fn()}
        onActivity={jest.fn()}
        onDetail={jest.fn()}
      />,
    );
  });
  // One line, beside the amount that is already spendable, because that is the
  // same question asked twice.
  const shown = text(tree);
  expect(shown).toContain('30,000 |   | sats |  arriving');
  expect(shown).toContain('ready to send');
  // The engine's running commentary is not the wallet page's job. It was
  // paragraphs of it, above the Send button, saying what Activity already says.
  expect(shown).not.toContain('Moving them failed');
  expect(shown).not.toContain('Available when the transfer confirms');
  expect(shown).not.toContain('has not confirmed yet');
  await act(async () => tree.unmount());
});

test('a wallet with nothing in flight shows no arriving line at all', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
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
  });
  expect(text(tree)).not.toContain('arriving');
  await act(async () => tree.unmount());
});
