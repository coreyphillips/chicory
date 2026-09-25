import React from 'react';
import { TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import HapticFeedback from 'react-native-haptic-feedback';
import { parsePayment } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { copy } from '../../../design/copy';
import { SendScreen } from '../../../screens/Send';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests } from '../../../stage/heldRequests';
import { alerts, field, press } from '../../../../test-support/query';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * A request as it enters Send (REDESIGN.md 6, Engine errors): one the parser
 * refuses is refused as it arrives, in the well with a cross, and never
 * takes the accepted chip first, so no amount is keyed for a request that
 * cannot be paid.
 */
const ADDRESS = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const LNURL =
  'LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS';

/** What the parser says of a request it refuses. */
function refusalOf(request: string): string {
  const parsed = parsePayment(request);
  if (parsed.kind !== 'invalid') throw new Error(`${request} is payable`);
  return parsed.message;
}

const said = jest.mocked(announce);
const felt = () =>
  jest.mocked(HapticFeedback.trigger).mock.calls.map(([kind]) => kind);
const logged = () => recentDiagnostics().map(entry => entry.code);

type Props = Partial<React.ComponentProps<typeof SendScreen>>;

async function draw(client: object = {}, props: Props = {}) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <SendScreen
          client={client as WalletAdapter}
          onActivity={jest.fn()}
          onRefresh={jest.fn()}
          onBusy={jest.fn()}
          {...props}
        />
      </GestureHandlerRootView>,
    );
  });
  return tree;
}

/** The well's text field, or undefined while the request is a chip. */
const well = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(TextInput)
    .find(node => node.props.accessibilityLabel === copy.send.request);

/** Whether the request shows as the accepted chip rather than the well. */
const chipped = (tree: ReactTestRenderer) => !well(tree);

/** Leaves the well, as a finger tapping elsewhere or the return key does. */
const leave = (tree: ReactTestRenderer) =>
  act(async () => well(tree)!.props.onBlur());

beforeEach(() => {
  clearHeldRequests();
  clearDiagnostics();
  said.mockClear();
  jest.mocked(HapticFeedback.trigger).mockClear();
});

describe('a request the parser refuses', () => {
  test('pasted, stays in the well with a cross, felt, said and logged, and is never a chip', async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(LNURL);
    const tree = await draw();
    await press(tree, copy.send.paste);
    expect(chipped(tree)).toBe(false);
    expect(well(tree)!.props.value).toBe(LNURL);
    const why = refusalOf(LNURL);
    expect(alerts(tree)).toEqual([why]);
    expect(felt()).toContain('notificationError');
    expect(logged()).toContain('LNURL_UNSUPPORTED');
    expect(said).toHaveBeenCalledWith(why, { assertive: true });
    expect(said).not.toHaveBeenCalledWith(copy.send.pasted, expect.anything());
    await act(async () => tree.unmount());
  });

  test('brought by a link, opens in the well with its cross rather than as a chip', async () => {
    const tree = await draw({}, { initialRequest: 'user@example.com' });
    expect(chipped(tree)).toBe(false);
    expect(alerts(tree)).toEqual([refusalOf('user@example.com')]);
    expect(logged()).toContain('LIGHTNING_ADDRESS_UNSUPPORTED');
    await act(async () => tree.unmount());
  });

  test('typed and left, stays in the well, and is refused once until it changes', async () => {
    const tree = await draw();
    await act(async () =>
      field(tree, copy.send.request).props.onChangeText('demo'),
    );
    expect(alerts(tree)).toEqual([]);
    await leave(tree);
    expect(chipped(tree)).toBe(false);
    expect(alerts(tree)).toEqual([refusalOf('demo')]);
    await leave(tree);
    expect(felt().filter(kind => kind === 'notificationError')).toHaveLength(1);
    await act(async () => tree.unmount());
  });
});

describe('a request the parser reads', () => {
  test('pasted, is taken as a chip', async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(ADDRESS);
    const tree = await draw();
    await press(tree, copy.send.paste);
    expect(chipped(tree)).toBe(true);
    expect(alerts(tree)).toEqual([]);
    expect(said).toHaveBeenCalledWith(copy.send.pasted);
    await act(async () => tree.unmount());
  });

  test('typed and left, is taken as a chip', async () => {
    const tree = await draw();
    await act(async () =>
      field(tree, copy.send.request).props.onChangeText(ADDRESS),
    );
    await leave(tree);
    expect(chipped(tree)).toBe(true);
    await act(async () => tree.unmount());
  });
});
