import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import HapticFeedback from 'react-native-haptic-feedback';
import { Path } from 'react-native-svg';
import { parsePayment } from '@beignet/wallet-core';
import type { SendResult, SendReview } from '@beignet/wallet-core';
import { announce } from '../../../design/announce';
import { Scanner } from '../../../components/Scanner';
import { copy } from '../../../design/copy';
import { GLYPHS, HISTORY_GLYPH } from '../../../design/glyphs';
import { palette } from '../../../design/palette';
import { SendScreen } from '../../../screens/Send';
import { shortRequest } from '../model';
import {
  clearDiagnostics,
  recentDiagnostics,
} from '../../../services/diagnosticLog';
import type { WalletAdapter } from '../../../services/wallet';
import { clearHeldRequests, holdRequest } from '../../../stage/heldRequests';
import { enterAmount } from '../../../../test-support/keypad';
import {
  activate,
  alerts,
  field,
  find,
  press,
} from '../../../../test-support/query';

jest.mock('../../../design/announce', () => ({ announce: jest.fn() }));

/**
 * A request as it enters Send (REDESIGN.md 6, Engine errors): one the parser
 * refuses is refused as it arrives, in the well with a cross, and never
 * takes the accepted chip first, so no amount is keyed for a request that
 * cannot be paid. Past a payment, the way to the history is never the orbit
 * that says money is moving. The review's side controls sit on the page
 * edges, and what a finger holds is 48pt or more (REDESIGN.md 3.4).
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

const quote: SendReview = {
  id: 'review-entry',
  destination: 'recipient',
  description: '',
  amountSats: 4_200,
  feeSats: 20,
  feeLabel: 'Maximum fee',
  totalSats: 4_220,
  route: 'bitcoin',
  expiresAt: Date.now() + 600_000,
  warnings: [],
};

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

describe('a refused request in the well', () => {
  test('shows short, on two lines at most, and whole once touched to change it', async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(LNURL);
    const tree = await draw();
    await press(tree, copy.send.paste);
    const shown = () =>
      tree.root
        .findAllByType(Text)
        .filter(node => node.props.children === shortRequest(LNURL));
    // Folded, in the middle-shortened form a chip shows, on a line or two.
    const [folded] = shown();
    expect(folded.props.numberOfLines).toBe(2);
    expect(shortRequest(LNURL).length).toBeLessThan(LNURL.length / 4);
    // The field keeps the whole request, for a screen reader and to change
    // it, with its own text out of sight over the folded one.
    expect(well(tree)!.props.value).toBe(LNURL);
    expect(StyleSheet.flatten(well(tree)!.props.style).color).toBe(
      'transparent',
    );
    await act(async () => well(tree)!.props.onFocus());
    expect(shown()).toEqual([]);
    expect(StyleSheet.flatten(well(tree)!.props.style).color).toBe(
      palette.cream,
    );
    await leave(tree);
    expect(shown()).toHaveLength(1);
    await act(async () => tree.unmount());
  });

  test("keeps the well's paste and scan as bare glyphs, as the empty well draws them", async () => {
    const grounds = (tree: ReactTestRenderer) =>
      [copy.send.paste, copy.send.scan].map(
        label =>
          StyleSheet.flatten(
            tree.root.find(
              node =>
                typeof node.type === 'string' &&
                node.props.accessibilityLabel === label,
            ).props.style,
          ).backgroundColor,
      );
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(LNURL);
    const tree = await draw();
    expect(grounds(tree)).toEqual(['transparent', 'transparent']);
    await press(tree, copy.send.paste);
    expect(alerts(tree)).toEqual([refusalOf(LNURL)]);
    expect(grounds(tree)).toEqual(['transparent', 'transparent']);
    await act(async () => tree.unmount());
  });
});

describe('the review control', () => {
  /** The review control, drawn whether or not it takes a tap. */
  const control = (tree: ReactTestRenderer) =>
    tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.send.review,
    );
  const looksDisabled = (tree: ReactTestRenderer) => {
    const { backgroundColor, borderColor } = StyleSheet.flatten(
      control(tree).props.style,
    );
    return (
      control(tree).props.accessibilityState.disabled === true &&
      backgroundColor === palette.mocha &&
      borderColor === palette.husk &&
      find(tree, copy.send.review) === undefined
    );
  };

  test('is drawn and told disabled while the request is refused, and says why', async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(LNURL);
    const tree = await draw();
    expect(looksDisabled(tree)).toBe(true);
    expect(control(tree).props.accessibilityHint).toBe(copy.send.reviewWaits);
    await press(tree, copy.send.paste);
    expect(looksDisabled(tree)).toBe(true);
    expect(control(tree).props.accessibilityHint).toBe(copy.send.reviewRefused);
    // Even with an amount keyed in.
    await enterAmount(tree, '4200');
    expect(looksDisabled(tree)).toBe(true);
    await act(async () => tree.unmount());
  });

  test('waits for an amount, then takes the review', async () => {
    const prepareSend = jest.fn().mockResolvedValue(quote);
    const tree = await draw({ prepareSend }, { initialRequest: ADDRESS });
    expect(looksDisabled(tree)).toBe(true);
    expect(control(tree).props.accessibilityHint).toBe(copy.send.amountWaits);
    await enterAmount(tree, '4200');
    expect(looksDisabled(tree)).toBe(false);
    await press(tree, copy.send.review);
    expect(prepareSend).toHaveBeenCalledWith({
      request: ADDRESS,
      amountSats: 4200,
    });
    await act(async () => tree.unmount());
  });

  test('takes the review at once for a request that names its amount', async () => {
    const tree = await draw(
      {},
      { initialRequest: `bitcoin:${ADDRESS}?amount=0.000042` },
    );
    expect(looksDisabled(tree)).toBe(false);
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

/** The paths the control labelled `label` draws. */
function drawnBy(tree: ReactTestRenderer, label: string): string[] {
  const control = find(tree, label);
  if (!control) throw new Error(`No control labelled "${label}".`);
  return control.findAllByType(Path).map(path => path.props.d);
}

describe('the way to the history', () => {
  const ORBIT = GLYPHS.orbit.map(part => part.d);
  const HISTORY = GLYPHS[HISTORY_GLYPH].map(part => part.d);

  test('under a payment that is done is not the orbit of money moving', async () => {
    const sent: SendResult = {
      id: 'p-entry',
      status: 'completed',
      amountSats: 4_200,
      feeSats: 0,
      txid: 'a'.repeat(64),
      message: 'Sent.',
    };
    const tree = await draw(
      {
        prepareSend: jest.fn().mockResolvedValue(quote),
        send: jest.fn().mockResolvedValue(sent),
      },
      { initialRequest: ADDRESS },
    );
    await enterAmount(tree, '4200');
    await press(tree, copy.send.review);
    await activate(tree, copy.send.sendSats(4_200));
    const glyph = drawnBy(tree, copy.send.viewActivity);
    expect(glyph).not.toEqual([]);
    expect(glyph).not.toEqual(ORBIT);
    // The history's glyph, as Receive's receipt draws it.
    expect(glyph).toEqual(HISTORY);
    await act(async () => tree.unmount());
  });

  test('under the held ring is not the orbit either', async () => {
    const request = `bitcoin:${ADDRESS}?label=entry-held`;
    holdRequest(request, { status: 'uncertain' });
    const tree = await draw({}, { initialRequest: request });
    expect(drawnBy(tree, copy.send.viewActivity)).not.toEqual(ORBIT);
    expect(drawnBy(tree, copy.send.viewActivity)).toEqual(HISTORY);
    await act(async () => tree.unmount());
  });
});

test("the review's pencil and a refusal's mark sit on the page edges", async () => {
  const tree = await draw(
    { prepareSend: jest.fn().mockResolvedValue(quote) },
    { initialRequest: ADDRESS },
  );
  await enterAmount(tree, '4200');
  await press(tree, copy.send.review);
  expect(find(tree, copy.send.edit)).toBeDefined();
  // The two side slots either side of the hold, as drawn.
  const slots = tree.root
    .findAll(
      node =>
        typeof node.type === 'string' &&
        StyleSheet.flatten(node.props.style)?.width === 56,
    )
    .map(node => StyleSheet.flatten(node.props.style).alignItems);
  expect(slots).toEqual(['flex-start', 'flex-end']);
  await act(async () => tree.unmount());
});

describe('what a finger holds', () => {
  test('the chip takes a touch 48pt tall or more', async () => {
    const tree = await draw({}, { initialRequest: ADDRESS });
    const chip = tree.root.find(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityLabel === copy.send.request &&
        node.props.accessibilityRole === 'button',
    );
    const { minHeight } = StyleSheet.flatten(chip.props.style);
    const { top = 0, bottom = 0 } = chip.props.hitSlop ?? {};
    expect(minHeight + top + bottom).toBeGreaterThanOrEqual(48);
    await act(async () => tree.unmount());
  });

  test('the empty well keeps its height at large text, where a scanned code collapses to', async () => {
    const tree = await draw();
    expect(well(tree)!.props.maxFontSizeMultiplier).toBe(1.4);
    await act(async () => tree.unmount());
  });

  test("a refusal's mark is 48pt, to be held for its words", async () => {
    jest.mocked(Clipboard.getString).mockResolvedValueOnce(LNURL);
    const tree = await draw();
    await press(tree, copy.send.paste);
    const [mark] = tree.root.findAll(
      node =>
        typeof node.type === 'string' &&
        node.props.accessibilityRole === 'alert',
    );
    const { minWidth, minHeight } = StyleSheet.flatten(mark.props.style);
    expect(Math.min(minWidth, minHeight)).toBeGreaterThanOrEqual(48);
    await act(async () => tree.unmount());
  });
});

test('the step under the request slides as the request opens or closes', async () => {
  const tree = await draw({}, { initialRequest: ADDRESS });
  // The step that holds the amount enters as a whole and moves by a layout
  // transition, so a chip opening into the taller well pushes it smoothly.
  const steps = tree.root.findAll(
    node =>
      typeof node.type !== 'string' &&
      node.props.entering !== undefined &&
      node.props.layout !== undefined &&
      node.findAll(
        inner => inner.props.accessibilityLabel === copy.amount.field,
      ).length > 0,
  );
  expect(steps).not.toEqual([]);
  await act(async () => tree.unmount());
});

test('a scan Send opens by itself keeps a test network’s slate and flask', async () => {
  // Without the canvas's overlay (no onScan), Send draws the camera itself.
  for (const test of [true, false]) {
    const tree = await draw({}, { test });
    await press(tree, copy.send.scan);
    const [scanner] = tree.root.findAllByType(Scanner);
    expect(scanner.props.test).toBe(test);
    const flasks = tree.root.findAll(
      node => node.props.testID === 'scan-flask',
    );
    expect(flasks.length > 0).toBe(test);
    await act(async () => tree.unmount());
  }
});
