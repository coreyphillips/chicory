import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import { parsePayment, validatePrimaryUri } from '@beignet/wallet-core';
import { announce } from '../src/design/announce';
import { Scanner } from '../src/components/Scanner';
import { copy } from '../src/design/copy';
import { PROMPT_SETTLE_MS } from '../src/stage/systemPrompt';
import { mount } from '../test-support/guard';
import { find } from '../test-support/query';

/**
 * A pubky and the scanner (REDESIGN.md 6, Send): a payment scan takes one,
 * for Send to look up, and the Settings scans, which bring their own check,
 * refuse it as they did. Driven through the paste fallback, which reads a
 * code by the same check the camera's reads go through.
 */
jest.mock('react-native-camera-kit', () => ({
  Camera: 'Camera',
  CameraType: { Back: 'back', Front: 'front' },
}));
jest.mock('../src/design/announce', () => ({ announce: jest.fn() }));

const KEY = '5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo';

beforeEach(() => {
  jest.useFakeTimers();
  jest.mocked(announce).mockClear();
});
afterEach(async () => {
  await act(async () => {
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  });
  jest.useRealTimers();
});

type Props = Partial<React.ComponentProps<typeof Scanner>>;

/** Pastes `text` into a scanner drawn with `props`, and returns what it took. */
async function pasted(text: string, props: Props = {}) {
  const onDetected = jest.fn();
  jest.mocked(Clipboard.getString).mockResolvedValueOnce(text);
  const tree = await mount(
    <GestureHandlerRootView>
      <Scanner onDetected={onDetected} onCancel={jest.fn()} {...props} />
    </GestureHandlerRootView>,
  );
  await act(async () => {
    await find(tree, copy.scan.paste)!.props.onPress();
  });
  await act(async () => tree.unmount());
  return onDetected;
}

/** Settings > Empty wallet's check: a bare Bitcoin address. */
const addressOnly = (value: string) => {
  const parsed = parsePayment(value, { network: 'mainnet' });
  if (parsed.kind !== 'onchain') throw new Error(copy.scan.addressInvalid);
  return parsed.address;
};

test.each([KEY, `pubky${KEY}`, `pubky://${KEY}`])(
  'a payment scan takes %s as it is, and says a pubky was found',
  async text => {
    const onDetected = await pasted(text);
    expect(onDetected).toHaveBeenCalledWith(text, 'clipboard');
    expect(announce).toHaveBeenCalledWith(copy.scan.pubkyDetected);
  },
);

test('a payment scan still refuses a key with a path', async () => {
  const onDetected = await pasted(`pubky://${KEY}/pub/paykit`);
  expect(onDetected).not.toHaveBeenCalled();
});

test.each<[string, Props]>([
  ['primary node', { purpose: 'primary', validate: validatePrimaryUri }],
  ['address', { purpose: 'address', validate: addressOnly }],
])('the Settings scan for a %s refuses a pubky', async (_, props) => {
  for (const text of [KEY, `pubky://${KEY}`]) {
    const onDetected = await pasted(text, props);
    expect(onDetected).not.toHaveBeenCalled();
  }
  expect(announce).not.toHaveBeenCalledWith(copy.scan.pubkyDetected);
});
