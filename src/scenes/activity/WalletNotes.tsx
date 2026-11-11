import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useLayoutEffect,
  useState,
} from 'react';
import type { PropsWithChildren } from 'react';
import type { Activity, WalletRecord } from '@beignet/wallet-core';
import { noteMoves, paymentNoteKeys } from '../../services/paymentNotes';
import type { NoteMap, PaymentNoteStore } from '../../services/paymentNotes';

const EMPTY: NoteMap = new Map();
const EMPTY_KEYS: ReadonlyMap<string, string> = new Map();
interface WalletNotes {
  keys: ReadonlyMap<string, string>;
  entries: NoteMap;
  save?: (item: Activity, text: string) => void;
}
const Context = createContext<WalletNotes>({
  entries: EMPTY,
  keys: EMPTY_KEYS,
});
export const useWalletNotes = () => useContext(Context);

export function WalletNotesProvider({
  wallet,
  activity,
  open,
  children,
}: PropsWithChildren<{
  wallet: Pick<WalletRecord, 'id' | 'network'>;
  activity: readonly Activity[];
  open?: () => PaymentNoteStore;
}>) {
  const keys = useMemo(() => paymentNoteKeys(activity), [activity]);
  const scope = JSON.stringify([wallet.network, wallet.id]);
  const [loaded, setLoaded] = useState<{
    open: typeof open;
    scope: string;
    store: PaymentNoteStore;
    entries: NoteMap;
  } | null>(null);
  const current =
    loaded?.open === open && loaded?.scope === scope ? loaded : null;

  useEffect(() => {
    if (!open) return;
    try {
      const store = open();
      setLoaded({ open, scope, store, entries: store.read(scope) });
    } catch {
      // History can still be used if the device cannot open the notes table.
    }
  }, [open, scope]);

  useEffect(() => {
    if (!current) return;
    const moves = noteMoves(activity, current.entries);
    if (!moves.size) return;
    try {
      current.store.move(scope, moves);
    } catch {
      // A failed move leaves the original notes intact for the next read.
      return;
    }
    const entries = new Map(current.entries);
    for (const [from, to] of moves) {
      entries.set(to, entries.get(from)!);
      entries.delete(from);
    }
    setLoaded({ ...current, entries });
  }, [activity, current, scope]);

  // Detail can keep showing its original row after a live read replaced it.
  // A stale editor must never write a note for that former row.
  const latest = useRef({ keys, scope, open });
  useLayoutEffect(() => {
    latest.current = { keys, scope, open };
  }, [keys, scope, open]);
  const save = useCallback(
    (item: Activity, text: string) => {
      const key = keys.get(item.id);
      if (
        !current ||
        !key ||
        latest.current.scope !== scope ||
        latest.current.open !== open ||
        latest.current.keys.get(item.id) !== key
      )
        throw new Error('Payment note unavailable.');
      const note = {
        text: text.trim(),
        address: item.address ?? current.entries.get(key)?.address,
      };
      current.store.save(scope, key, note);
      setLoaded(previous => {
        if (previous?.store !== current.store || previous.scope !== scope)
          return previous;
        const entries = new Map(previous.entries);
        if (note.text) entries.set(key, note);
        else entries.delete(key);
        return { ...previous, entries };
      });
    },
    [current, keys, open, scope],
  );

  const value = useMemo(
    () => ({
      keys,
      entries: current?.entries ?? EMPTY,
      save: current ? save : undefined,
    }),
    [current, keys, save],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
