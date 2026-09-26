import React from 'react';
import {
  PermissionsAndroid,
  Platform,
  TurboModuleRegistry,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import Clipboard from '@react-native-clipboard/clipboard';
import type { Activity, ReceiveRequest } from '@beignet/wallet-core';
import { ReceiveRequestDetails } from '../src/components/ReceiveRequestDetails';
import { Scanner } from '../src/components/Scanner';
import { copy } from '../src/design/copy';
import { PROMPT_SETTLE_MS, systemPromptOpen } from '../src/stage/systemPrompt';
import type { WalletAdapter } from '../src/services/wallet';
import { requestOf } from '../test-support/fixtures';
import { mount } from '../test-support/guard';
import { componentName, find } from '../test-support/query';

/**
 * The system prompts Scan and a payment's detail raise (REDESIGN.md 2.3):
 * the camera permission and the paste permission. iOS makes the app
 * inactive while one is up, and the privacy cover replaced the scan reveal
 * behind the camera prompt (P10, 51a-scan-camera-prompt). Each is raised
 * inside `duringSystemPrompt`, so the cover leaves the screen in place.
 *
 * A file of its own, since which prompts are open is the app's own state,
 * and a suite that pastes on real timers would leave its spans open here.
 */
jest.mock('react-native-camera-kit', () => ({
  Camera: 'Camera',
  CameraType: { Back: 'back', Front: 'front' },
}));

beforeEach(() => jest.useFakeTimers());
afterEach(async () => {
  await act(async () => {
    jest.advanceTimersByTime(PROMPT_SETTLE_MS);
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const PAYABLE =
  'bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4?amount=0.0001';

function scanner() {
  return (
    <GestureHandlerRootView>
      <Scanner onDetected={jest.fn()} onCancel={jest.fn()} />
    </GestureHandlerRootView>
  );
}

/** Every host node the tree draws labelled `label`. */
const labelled = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      typeof node.type === 'string' && node.props.accessibilityLabel === label,
  );

/** The camera views drawn: camera-kit's mock draws a host named Camera. */
const cameras = (tree: ReactTestRenderer) =>
  tree.root.findAll(node => componentName(node.type) === 'Camera');

/** A clipboard read that waits for `answer`, as one behind a prompt does. */
function heldClipboard() {
  const held: { answer: (text: string) => void } = { answer: () => {} };
  jest.mocked(Clipboard.getString).mockImplementationOnce(
    () =>
      new Promise<string>(resolve => {
        held.answer = resolve;
      }),
  );
  return held;
}

describe('a prompt the scan raises', () => {
  /** Lets the span a prompt leaves behind it run out. */
  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    });

  test('a paste is read inside a system prompt', async () => {
    const clipboard = heldClipboard();
    const tree = await mount(scanner());
    expect(systemPromptOpen()).toBe(false);
    await act(async () => {
      // Not awaited: the read waits on the prompt.
      find(tree, copy.scan.paste)!.props.onPress();
    });
    expect(systemPromptOpen()).toBe(true);
    await act(async () => clipboard.answer(PAYABLE));
    await settle();
    expect(systemPromptOpen()).toBe(false);
    await act(async () => tree.unmount());
  });

  test('iOS asks for a camera never asked for inside a system prompt, and mounts it once allowed', async () => {
    let allow!: (granted: boolean) => void;
    const kit = {
      checkDeviceCameraAuthorizationStatus: jest.fn().mockResolvedValue(-1),
      requestDeviceCameraAuthorization: jest.fn(
        () =>
          new Promise<boolean>(resolve => {
            allow = resolve;
          }),
      ),
    };
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(kit as never);
    const tree = await mount(scanner());
    expect(kit.requestDeviceCameraAuthorization).toHaveBeenCalledTimes(1);
    expect(systemPromptOpen()).toBe(true);
    // Not mounted while it is asked for, so it does not ask a second time.
    expect(cameras(tree)).toHaveLength(0);
    await act(async () => allow(true));
    expect(cameras(tree)).toHaveLength(1);
    await settle();
    expect(systemPromptOpen()).toBe(false);
    await act(async () => tree.unmount());
  });

  test.each([
    [true, 1, undefined],
    [false, 0, copy.scan.camera],
  ])(
    'iOS already answered (%s) asks nothing',
    async (status, mounted, heading) => {
      const kit = {
        checkDeviceCameraAuthorizationStatus: jest
          .fn()
          .mockResolvedValue(status),
        requestDeviceCameraAuthorization: jest.fn(),
      };
      jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(kit as never);
      const tree = await mount(scanner());
      expect(kit.requestDeviceCameraAuthorization).not.toHaveBeenCalled();
      expect(systemPromptOpen()).toBe(false);
      expect(cameras(tree)).toHaveLength(mounted);
      if (heading) expect(labelled(tree, heading)).toHaveLength(1);
      await act(async () => tree.unmount());
    },
  );

  test('Android asks for the camera inside a system prompt', async () => {
    let answer!: (result: string) => void;
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(PermissionsAndroid, 'request').mockReturnValue(
      new Promise<string>(resolve => {
        answer = resolve;
      }) as never,
    );
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    const tree = await mount(scanner());
    expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1);
    expect(systemPromptOpen()).toBe(true);
    await act(async () => answer(PermissionsAndroid.RESULTS.GRANTED));
    await settle();
    expect(systemPromptOpen()).toBe(false);
    await act(async () => tree.unmount());
  });
});

describe("a prompt a payment's detail raises", () => {
  test('pasting the original request is read inside a system prompt', async () => {
    const request = {
      ...requestOf(),
      legacy: true,
      address: undefined,
    } as unknown as ReceiveRequest;
    const item = {
      id: `payment:${request.paymentHash}`,
      kind: 'request',
      title: 'Payment request',
      description: '',
      amountSats: 10_000,
      feeSats: 0,
      status: 'pending',
      timestamp: Date.now(),
      paymentHash: request.paymentHash,
      receiveRequest: request,
    } as Activity;
    const client = {
      importReceiveRequest: jest.fn(),
    } as unknown as WalletAdapter;
    const tree = await mount(
      <ReceiveRequestDetails item={item} client={client} />,
    );
    await act(async () => {
      find(tree, copy.receive.linkOriginal)!.props.onPress();
    });
    const clipboard = heldClipboard();
    await act(async () => {
      find(tree, copy.receive.paste)!.props.onPress();
    });
    expect(systemPromptOpen()).toBe(true);
    await act(async () => clipboard.answer('bitcoin:original'));
    await act(async () => {
      jest.advanceTimersByTime(PROMPT_SETTLE_MS);
    });
    expect(systemPromptOpen()).toBe(false);
    await act(async () => tree.unmount());
  });
});
