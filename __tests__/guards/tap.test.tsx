import React from 'react';
import { AppState, Linking, PermissionsAndroid, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  REFUSAL_QUIET_MS,
  Scanner,
  refusal,
} from '../../src/components/Scanner';
import * as Announce from '../../src/design/announce';
import { copy } from '../../src/design/copy';
import { haptics } from '../../src/design/haptics';
import { palette } from '../../src/design/palette';
import {
  TAP_ECHO_MS,
  tookByTap,
  usePaymentLinks,
} from '../../src/services/links';
import type { TapRecord } from '../../src/services/ndef';
import { setTapReader } from '../../src/services/tapReader';
import { guardData, snapshotOf } from '../../test-support/fixtures';
import { guard, mount } from '../../test-support/guard';
import type { GuardedState } from '../../test-support/guard';
import {
  componentName,
  find,
  press,
  pressableLabels,
  visibleText,
  whispers,
} from '../../test-support/query';
import { fakeTapReader, recordOf, uriRecord } from '../../test-support/tap';
import type { FakeTapReader } from '../../test-support/tap';

/**
 * Tap to pay in the payment scanner (docs/TAP-TO-PAY.md), under the copy
 * guard (REDESIGN.md rule 1) and the accessibility check (section 9), and
 * then what it does: a request read from a tag held to the phone goes to
 * Send once, as a pasted one does and never as the camera's, a tag that
 * cannot be paid is refused on the mark, and the radio is the app's only
 * while a payment scan is open and in front.
 */

let mockCamera = true;
jest.mock('react-native-camera-kit', () => ({
  get Camera() {
    return mockCamera ? 'Camera' : undefined;
  },
  CameraType: { Back: 'back', Front: 'front' },
}));

afterEach(() => {
  setTapReader(null);
  jest.restoreAllMocks();
  jest.mocked(AppState.addEventListener).mockClear();
  mockCamera = true;
});

/** A BIP 173 example address, as a payment link: a request that can be paid. */
const PAYABLE =
  'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.0001';
/** A real invoice for 24,425 sats, from the send suite. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
/** The same invoice as a till writes it for a dense QR. */
const CAPITALS = INVOICE.toUpperCase();
/** An LNURL: read by the parser, then refused as nothing this wallet pays. */
const LNURL =
  'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns';

/** A web link on a sticker: a tag with a message and nothing to pay. */
const WEB_TAG = [uriRecord('example.com/menu', 4)];

const data = guardData(snapshotOf());

function scanner(props: Partial<React.ComponentProps<typeof Scanner>> = {}) {
  return (
    <GestureHandlerRootView>
      <Scanner onDetected={jest.fn()} onCancel={jest.fn()} {...props} />
    </GestureHandlerRootView>
  );
}

/** An Android phone, where the scanner listens, with its camera answered. */
function android(camera: 'granted' | 'denied' = 'granted') {
  jest.replaceProperty(Platform, 'OS', 'android');
  jest
    .spyOn(PermissionsAndroid, 'request')
    .mockResolvedValue(
      camera === 'granted'
        ? PermissionsAndroid.RESULTS.GRANTED
        : PermissionsAndroid.RESULTS.DENIED,
    );
  jest
    .spyOn(PermissionsAndroid, 'check')
    .mockResolvedValue(camera === 'granted');
}

/** The phone's NFC, standing in for the native reader. */
function nfc(answer: FakeTapReader['answer'] = 'ready'): FakeTapReader {
  const reader = fakeTapReader('ambient', answer);
  setTapReader(reader);
  return reader;
}

/** A tag is held to the phone. */
async function hold(reader: FakeTapReader, records: TapRecord[]) {
  await act(async () => reader.tag(records));
}

/** Every host node the tree draws labelled `label`. */
const labelled = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

const cameras = (tree: ReactTestRenderer) =>
  tree.root.findAll(node => componentName(node.type) === 'Camera');

/** The colour the tap mark's glyph is drawn in, or undefined with no mark. */
const markColour = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    node =>
      componentName(node.type) === 'GlyphSvg' &&
      node.props.name === 'contactless',
  )[0]?.props.color;

/** The app goes behind another and comes back. */
async function awayAndBack(between?: () => void) {
  const changed = jest
    .mocked(AppState.addEventListener)
    .mock.calls.filter(([event]) => event === 'change')
    .map(([, handler]) => handler);
  await act(async () => changed.forEach(handler => handler('background')));
  between?.();
  await act(async () => changed.forEach(handler => handler('active')));
}

async function after(
  element: React.ReactElement,
  then: (tree: ReactTestRenderer) => Promise<void>,
) {
  const tree = await mount(element);
  await then(tree);
  return tree;
}

const GUARDED: GuardedState[] = [
  {
    name: 'the scanner listening for a tap',
    render: () => {
      android();
      nfc();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner with NFC switched off',
    render: () => {
      android();
      nfc('off');
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner with a tag that holds no request',
    render: () => {
      android();
      const reader = nfc();
      return after(scanner(), () => hold(reader, WEB_TAG));
    },
    data,
  },
  {
    name: 'the scanner with a tag it reads and refuses',
    render: () => {
      android();
      const reader = nfc();
      return after(scanner(), () => hold(reader, [uriRecord(LNURL)]));
    },
    data,
  },
  {
    name: 'the scanner with a tapped request it can pay',
    render: () => {
      android();
      const reader = nfc();
      return after(scanner(), () =>
        hold(reader, [uriRecord(`lightning:${CAPITALS}`)]),
      );
    },
    data,
  },
  {
    name: 'the scanner listening for a tap with the camera switched off',
    render: () => {
      android('denied');
      nfc();
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner with the camera and NFC both switched off',
    render: () => {
      android('denied');
      nfc('off');
      return mount(scanner());
    },
    data,
  },
  {
    name: 'the scanner listening for a tap in a build without a camera',
    render: () => {
      android();
      mockCamera = false;
      nfc();
      return mount(scanner());
    },
    data,
  },
];

guard('tap', GUARDED);

describe('a request read from a tag', () => {
  test('goes to Send once, as a tap, with a thud', async () => {
    android();
    const reader = nfc();
    const thud = jest.spyOn(haptics, 'thud');
    const said = jest.spyOn(Announce, 'announce');
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    expect(reader.reading()).toBe(true);
    await hold(reader, [uriRecord(`lightning:${CAPITALS}`)]);
    expect(onDetected).toHaveBeenCalledTimes(1);
    // A till's lightning: prefix is not part of the invoice the parser reads.
    expect(onDetected).toHaveBeenCalledWith(CAPITALS, 'tap');
    expect(thud).toHaveBeenCalledTimes(1);
    expect(said).toHaveBeenCalledWith(copy.scan.detected);
    // The phone is still on the terminal as Send opens. The tag read again
    // must not open a second one.
    await hold(reader, [uriRecord(`lightning:${CAPITALS}`)]);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(thud).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  test.each([
    ['the BIP 321 form', `bitcoin:?lightning=${INVOICE}`],
    ['its field name in capitals', `bitcoin:?LIGHTNING=${CAPITALS}`],
    ['all of it in capitals', `BITCOIN:?LIGHTNING=${CAPITALS}`],
    ['a request on chain', PAYABLE],
  ])('is taken as the tag wrote it: %s', async (_, uri) => {
    android();
    const reader = nfc();
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    expect(refusal(uri)).toBeNull();
    await hold(reader, [uriRecord(uri)]);
    expect(onDetected).toHaveBeenCalledWith(uri, 'tap');
    await act(async () => tree.unmount());
  });

  test('and a code the camera reads are one claim, whichever comes first', async () => {
    android();
    const reader = nfc();
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await hold(reader, [uriRecord(PAYABLE)]);
    await act(async () => {
      cameras(tree)[0].props.onReadCode({
        nativeEvent: { codeStringValue: INVOICE },
      });
    });
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => tree.unmount());

    const second = nfc();
    const again = jest.fn();
    const next = await mount(scanner({ onDetected: again }));
    await act(async () => {
      cameras(next)[0].props.onReadCode({
        nativeEvent: { codeStringValue: INVOICE },
      });
    });
    await hold(second, [uriRecord(PAYABLE)]);
    expect(again).toHaveBeenCalledTimes(1);
    expect(again).toHaveBeenCalledWith(INVOICE, 'camera');
    await act(async () => next.unmount());
  });

  test.each<[string, TapRecord[], string]>([
    [
      'written twice',
      [uriRecord(`lightning:${CAPITALS}`), uriRecord(`lightning:${CAPITALS}`)],
      CAPITALS,
    ],
    [
      'written bare and inside a link, the first spelling kept',
      [
        uriRecord(`lightning:${CAPITALS}`),
        uriRecord(`bitcoin:?lightning=${INVOICE}`),
      ],
      CAPITALS,
    ],
    [
      'beside a web link, which is not a second request',
      [uriRecord('example.com/receipt', 4), uriRecord(`lightning:${INVOICE}`)],
      INVOICE,
    ],
  ])('is one request when it is %s', async (_, records, request) => {
    android();
    const reader = nfc();
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await hold(reader, records);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(request, 'tap');
    await act(async () => tree.unmount());
  });

  test('is drawn nowhere: the mark is a glyph, with its words for a screen reader', async () => {
    android();
    nfc();
    const tree = await mount(scanner());
    expect(visibleText(tree)).toEqual([]);
    const [mark] = labelled(tree, copy.scan.tapReady);
    expect(mark.props.accessibilityRole).toBe('image');
    expect(markColour(tree)).toBe(palette.cream);
    expect(whispers(tree)).toContainEqual({
      label: copy.scan.tapReady,
      on: true,
    });
    // It is read, not pressed.
    expect(pressableLabels(tree)).toEqual(
      new Set([copy.scan.paste, copy.scan.chooseImage, copy.scan.close]),
    );
    await act(async () => tree.unmount());
  });
});

describe('a tag that cannot be paid', () => {
  test.each<[string, TapRecord[], string | null]>([
    ['a web link', WEB_TAG, copy.scan.tapNoRequest],
    [
      'a text record',
      [recordOf(1, 'T', '\u0002enhello')],
      copy.scan.tapNoRequest,
    ],
    ['no records at all', [], copy.scan.tapNoRequest],
    [
      'an LNURL written as a lightning: link',
      [uriRecord(`lightning:${LNURL}`)],
      refusal(LNURL, copy.scan.tapNoRequest),
    ],
    [
      'two different requests',
      [uriRecord(PAYABLE), uriRecord(`lightning:${INVOICE}`)],
      copy.scan.tapSeveral,
    ],
  ])(
    'is felt, said and kept on the mark, and the phone goes on listening: %s',
    async (_, records, why) => {
      android();
      const reader = nfc();
      const error = jest.spyOn(haptics, 'error');
      const said = jest.spyOn(Announce, 'announce');
      const onDetected = jest.fn();
      const tree = await mount(scanner({ onDetected }));
      await hold(reader, records);
      expect(onDetected).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(said).toHaveBeenCalledWith(why);
      const [mark] = labelled(tree, copy.scan.tapReady);
      expect(mark.props.accessibilityValue).toEqual({ text: why });
      expect(whispers(tree)).toContainEqual({ label: why, on: true });
      expect(visibleText(tree)).toEqual([]);
      // The camera reads on, and so does the radio.
      expect(cameras(tree)).toHaveLength(1);
      expect(reader.reading()).toBe(true);
      await hold(reader, [uriRecord(PAYABLE)]);
      expect(onDetected).toHaveBeenCalledWith(PAYABLE, 'tap');
      await act(async () => tree.unmount());
    },
  );

  test('says why the parser refused it, in a tag’s words and not a code’s', () => {
    const why = refusal(LNURL, copy.scan.tapNoRequest);
    expect(why).toContain(copy.scan.tapNoRequest);
    expect(why).not.toContain(copy.scan.invalid);
    expect(refusal(LNURL)).toContain(copy.scan.invalid);
  });

  test('held to the phone complains at most once in 1.5s, and a new one at once', async () => {
    android();
    const reader = nfc();
    const error = jest.spyOn(haptics, 'error');
    const now = jest.spyOn(Date, 'now');
    const tree = await mount(scanner());
    for (const at of [0, 400, 1_200]) {
      now.mockReturnValue(10_000 + at);
      await hold(reader, WEB_TAG);
    }
    expect(error).toHaveBeenCalledTimes(1);
    now.mockReturnValue(10_000 + REFUSAL_QUIET_MS);
    await hold(reader, WEB_TAG);
    expect(error).toHaveBeenCalledTimes(2);
    now.mockReturnValue(10_000 + REFUSAL_QUIET_MS + 100);
    await hold(reader, [uriRecord(`lightning:${LNURL}`)]);
    expect(error).toHaveBeenCalledTimes(3);
    await act(async () => tree.unmount());
  });

  test('with no message at all is a card that was near, and nothing is said of it', async () => {
    android();
    const reader = nfc();
    const error = jest.spyOn(haptics, 'error');
    const said = jest.spyOn(Announce, 'announce');
    const tree = await mount(scanner());
    said.mockClear();
    await act(async () => reader.fail('TAP_NO_NDEF'));
    expect(error).not.toHaveBeenCalled();
    expect(said).not.toHaveBeenCalled();
    const [mark] = labelled(tree, copy.scan.tapReady);
    expect(mark.props.accessibilityValue).toBeUndefined();
    expect(reader.reading()).toBe(true);
    await act(async () => tree.unmount());
  });

  test('whose message is larger than any request is refused unread', async () => {
    android();
    const reader = nfc();
    const said = jest.spyOn(Announce, 'announce');
    const tree = await mount(scanner());
    await act(async () => reader.fail('TAP_TOO_LARGE'));
    expect(said).toHaveBeenCalledWith(copy.scan.tapUnreadable);
    expect(reader.reading()).toBe(true);
    await act(async () => tree.unmount());
  });

  test('is passed over while a paste is being read', async () => {
    android();
    const reader = nfc();
    let finish!: (value: string) => void;
    jest.mocked(Clipboard.getString).mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          finish = resolve;
        }),
    );
    const error = jest.spyOn(haptics, 'error');
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await act(async () => {
      find(tree, copy.scan.paste)!.props.onPress();
    });
    await hold(reader, [uriRecord(PAYABLE)]);
    await hold(reader, WEB_TAG);
    expect(onDetected).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await act(async () => finish(INVOICE));
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected).toHaveBeenCalledWith(INVOICE, 'clipboard');
    await act(async () => tree.unmount());
  });
});

describe('the radio', () => {
  test('is asked for only by a payment scan', async () => {
    android();
    const reader = nfc();
    for (const purpose of ['primary', 'address'] as const) {
      const tree = await mount(scanner({ purpose, validate: value => value }));
      expect(labelled(tree, copy.scan.tapReady)).toHaveLength(0);
      await act(async () => tree.unmount());
    }
    expect(reader.asked).toEqual({
      status: 0,
      read: 0,
      cancel: 0,
      settings: 0,
    });
  });

  test('listens with the camera switched off, and with no camera at all', async () => {
    android('denied');
    const reader = nfc();
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    expect(cameras(tree)).toHaveLength(0);
    expect(labelled(tree, copy.scan.denied)).toHaveLength(1);
    expect(labelled(tree, copy.scan.tapReady)).toHaveLength(1);
    await hold(reader, [uriRecord(PAYABLE)]);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => tree.unmount());

    mockCamera = false;
    const second = nfc();
    const again = jest.fn();
    const next = await mount(scanner({ onDetected: again }));
    expect(labelled(next, copy.scan.missing)).toHaveLength(1);
    await hold(second, [uriRecord(PAYABLE)]);
    expect(again).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => next.unmount());
  });

  test('listens before the overlay lets the camera mount', async () => {
    android();
    const reader = nfc();
    const tree = await mount(scanner({ live: false }));
    expect(cameras(tree)).toHaveLength(0);
    expect(reader.reading()).toBe(true);
    await act(async () => tree.unmount());
  });

  test('is given back when the scan closes', async () => {
    android();
    const reader = nfc();
    const tree = await mount(scanner());
    expect(reader.asked.cancel).toBe(0);
    await act(async () => tree.unmount());
    expect(reader.asked.cancel).toBe(1);
    expect(reader.reading()).toBe(false);
  });

  test('is kept from one tag to the next, and not given up as the scanner draws again', async () => {
    android();
    const reader = nfc();
    const tree = await mount(scanner());
    await hold(reader, WEB_TAG);
    await hold(reader, [recordOf(1, 'T', '\u0002enhello')]);
    await act(async () => tree.update(scanner({ onDetected: jest.fn() })));
    expect(reader.asked.cancel).toBe(0);
    expect(reader.asked.read).toBe(3);
    await act(async () => tree.unmount());
  });

  test('hands a tag to the scanner as it stands now', async () => {
    android();
    const reader = nfc();
    const first = jest.fn();
    const second = jest.fn();
    const tree = await mount(scanner({ onDetected: first }));
    await act(async () => tree.update(scanner({ onDetected: second })));
    await hold(reader, [uriRecord(PAYABLE)]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => tree.unmount());
  });

  test('is given back behind another app and taken again in front', async () => {
    android();
    const reader = nfc();
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    expect(reader.asked).toMatchObject({ status: 1, read: 1, cancel: 0 });
    await awayAndBack(() => {
      expect(reader.asked.cancel).toBe(1);
      expect(reader.reading()).toBe(false);
    });
    // What the phone can do is asked again, since NFC may have changed.
    expect(reader.asked).toMatchObject({ status: 2, read: 2, cancel: 1 });
    await hold(reader, [uriRecord(PAYABLE)]);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => tree.unmount());
  });

  test('that fails under a read is asked what became of it', async () => {
    android();
    const reader = nfc();
    const tree = await mount(scanner());
    reader.answer = 'off';
    await act(async () => reader.fail('TAP_FAILED'));
    expect(labelled(tree, copy.scan.tapOff)).toHaveLength(1);
    expect(reader.reading()).toBe(false);
    await act(async () => tree.unmount());
  });

  test('that fails and still says it is ready is left alone until the app is next in front', async () => {
    android();
    const reader = nfc();
    const tree = await mount(scanner());
    await act(async () => reader.fail('TAP_FAILED'));
    expect(markColour(tree)).toBeUndefined();
    // One read and no more: a reader that fails at once is not asked in a
    // loop.
    expect(reader.asked.read).toBe(1);
    await awayAndBack();
    expect(labelled(tree, copy.scan.tapReady)).toHaveLength(1);
    expect(reader.reading()).toBe(true);
    await act(async () => tree.unmount());
  });
});

describe('NFC switched off', () => {
  test('is steam, and a way to the NFC settings', async () => {
    android();
    const reader = nfc('off');
    const tick = jest.spyOn(haptics, 'tick');
    const tree = await mount(scanner());
    expect(reader.asked.read).toBe(0);
    expect(markColour(tree)).toBe(palette.steam);
    const mark = find(tree, copy.scan.tapOff)!;
    expect(mark.props.accessibilityRole).toBe('button');
    expect(mark.props.accessibilityHint).toBe(copy.scan.tapOffHint);
    expect(whispers(tree)).toContainEqual({
      label: copy.scan.tapOff,
      on: true,
    });
    await press(tree, copy.scan.tapOff);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(reader.asked.settings).toBe(1);
    await act(async () => tree.unmount());
  });

  test('and switched on from the settings starts the listening', async () => {
    android();
    const reader = nfc('off');
    const onDetected = jest.fn();
    const tree = await mount(scanner({ onDetected }));
    await press(tree, copy.scan.tapOff);
    await awayAndBack(() => {
      reader.answer = 'ready';
    });
    expect(labelled(tree, copy.scan.tapReady)).toHaveLength(1);
    expect(markColour(tree)).toBe(palette.cream);
    expect(reader.reading()).toBe(true);
    await hold(reader, [uriRecord(PAYABLE)]);
    expect(onDetected).toHaveBeenCalledWith(PAYABLE, 'tap');
    await act(async () => tree.unmount());
  });
});

describe('a phone that cannot read a tag', () => {
  test('with no NFC draws no mark and never listens', async () => {
    android();
    const reader = nfc('missing');
    const tree = await mount(scanner());
    expect(markColour(tree)).toBeUndefined();
    expect(reader.asked.read).toBe(0);
    expect(pressableLabels(tree)).toEqual(
      new Set([copy.scan.paste, copy.scan.chooseImage, copy.scan.close]),
    );
    await act(async () => tree.unmount());
  });

  test('in a build with no reader is the scanner it was', async () => {
    android();
    const tree = await mount(scanner());
    expect(markColour(tree)).toBeUndefined();
    await act(async () => tree.unmount());
  });

  test('whose status cannot be asked draws no mark', async () => {
    android();
    const reader = nfc();
    jest.spyOn(reader, 'status').mockRejectedValue(new Error('gone'));
    const tree = await mount(scanner());
    expect(markColour(tree)).toBeUndefined();
    expect(reader.asked.read).toBe(0);
    await act(async () => tree.unmount());
  });
});

describe('the same tag offered again as a link', () => {
  /** A link arrives, as Android hands over a tag once the scan has closed. */
  async function linked(url: string) {
    let deliver: (event: { url: string }) => void = () => {};
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValue(null);
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((
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
    const tree = await mount(<Probe />);
    act(() => deliver({ url }));
    await act(async () => tree.unmount());
    return onRequest;
  }

  test('is dropped for a few seconds, however its scheme and case arrive', async () => {
    android();
    const reader = nfc();
    const now = jest.spyOn(Date, 'now').mockReturnValue(50_000);
    const tree = await mount(scanner());
    await hold(reader, [uriRecord(`BITCOIN:?LIGHTNING=${CAPITALS}`)]);
    await act(async () => tree.unmount());
    // Android lower-cases the scheme of what it hands over.
    now.mockReturnValue(50_000 + TAP_ECHO_MS - 1);
    expect(
      await linked(`bitcoin:?LIGHTNING=${CAPITALS}`),
    ).not.toHaveBeenCalled();
    // Another request is a link like any other.
    expect(await linked(PAYABLE)).toHaveBeenCalledWith(PAYABLE);
    // And so is the same one, once the tap is over.
    now.mockReturnValue(50_000 + TAP_ECHO_MS);
    expect(await linked(`bitcoin:?LIGHTNING=${CAPITALS}`)).toHaveBeenCalledWith(
      `bitcoin:?LIGHTNING=${CAPITALS}`,
    );
  });

  test('is dropped for a till’s lightning: link, which Send was given bare', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(90_000);
    tookByTap(CAPITALS);
    expect(await linked(`lightning:${CAPITALS}`)).not.toHaveBeenCalled();
    now.mockReturnValue(90_000 + TAP_ECHO_MS);
    expect(await linked(`lightning:${CAPITALS}`)).toHaveBeenCalledWith(
      CAPITALS,
    );
  });

  test('is a link like any other when the request came by camera or paste', async () => {
    android();
    nfc();
    jest.spyOn(Date, 'now').mockReturnValue(200_000);
    const tree = await mount(scanner());
    await act(async () => {
      cameras(tree)[0].props.onReadCode({
        nativeEvent: { codeStringValue: PAYABLE },
      });
    });
    await act(async () => tree.unmount());
    expect(await linked(PAYABLE)).toHaveBeenCalledWith(PAYABLE);
  });
});
