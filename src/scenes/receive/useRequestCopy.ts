import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { ReceiveRequestDetails } from '@beignet/wallet-core';
import { announce } from '../../design/announce';
import { copy } from '../../design/copy';
import { haptics } from '../../design/haptics';
import { usePaneActive } from '../../stage/panes/Pane';
import { requestCopyValue } from './model';
import type { RequestCopyFormat } from './model';

/** A delayed native tap must still belong to this payable request. Revoke
 * its callback on replacement, payment, leaving the pane, or wallet lock. */
export function useRequestCopy(
  request: ReceiveRequestDetails | null | undefined,
  payable: boolean,
  confirmation: string,
) {
  const live = usePaneActive();
  const [copies, setCopies] = useState(0);
  const read = useCallback(
    (format: RequestCopyFormat) => {
      if (
        !request ||
        !payable ||
        !live ||
        !(request.expiresAt > Date.now()) ||
        AppState.currentState === 'inactive' ||
        AppState.currentState === 'background'
      )
        return;
      return requestCopyValue(request, format);
    },
    [request, payable, live],
  );
  const current = useRef<typeof read | null>(null);
  useLayoutEffect(() => {
    current.current = read;
    return () => {
      current.current = null;
    };
  }, [read]);
  const value = useCallback(
    (format: RequestCopyFormat = 'request') =>
      current.current === read ? read(format) : undefined,
    [read],
  );
  const onCopy = useCallback(
    (format: RequestCopyFormat = 'request') => {
      const payload = value(format);
      if (!payload) return false;
      Clipboard.setString(payload);
      haptics.tick();
      announce(
        format === 'lightning'
          ? copy.receive.copiedLightning
          : format === 'bitcoin'
          ? copy.receive.copiedBitcoin
          : confirmation,
        { repeat: true },
      );
      setCopies(count => count + 1);
      return true;
    },
    [value, confirmation],
  );
  return { value, onCopy, copies };
}
