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
  save?: (item: Activity, text: string) => Promise<void>;
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
  const session = useMemo(
    () => ({
      open,
      scope,
      entries: EMPTY,
      store: null as PaymentNoteStore | null,
    }),
    [open, scope],
  );
  const [loaded, setLoaded] = useState<{
    session: typeof session;
    entries: NoteMap;
  } | null>(null);
  const current = loaded?.session === session ? loaded : null;

  const latest = useRef<{
    session: typeof session;
    keys: typeof keys;
    activity: typeof activity;
  } | null>(null);
  useLayoutEffect(() => {
    latest.current = { session, keys, activity };
    return () => {
      latest.current = null;
    };
  }, [session, keys, activity]);

  // Keep edits and raw-to-request moves ordered for each wallet. Returning to
  // a wallet also waits for its accepted writes before reading it again.
  const queues = useRef(new Map<string, Promise<void>>());
  const enqueue = useCallback(
    (walletScope: string, run: () => Promise<void>) => {
      const queue = queues.current;
      const result = (queue.get(walletScope) ?? Promise.resolve()).then(run);
      const tail = result.catch(() => {});
      queue.set(walletScope, tail);
      tail.then(() => {
        if (queue.get(walletScope) === tail) queue.delete(walletScope);
      });
      return result;
    },
    [],
  );

  const publish = useCallback(
    (entries: NoteMap) => {
      session.entries = entries;
      if (latest.current?.session === session) setLoaded({ session, entries });
    },
    [session],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    enqueue(scope, async () => {
      if (!active) return;
      const store = open();
      const entries = await store.read(scope);
      if (active) {
        session.store = store;
        publish(entries);
      }
    }).catch(() => {
      // History remains accessible when the device cannot read its notes.
    });
    return () => {
      active = false;
    };
  }, [enqueue, open, publish, scope, session]);

  useEffect(() => {
    if (!current || !noteMoves(activity, current.entries).size) return;
    enqueue(scope, async () => {
      const view = latest.current;
      if (view?.session !== session || !session.store) return;
      // A queued edit or a newer history snapshot can change the evidence
      // for a move. Recompute against the last acknowledged entries.
      const moves = noteMoves(view.activity, session.entries);
      if (!moves.size) return;
      await session.store.move(scope, moves);
      const entries = new Map(session.entries);
      for (const [from, to] of moves) {
        entries.set(to, entries.get(from)!);
        entries.delete(from);
      }
      publish(entries);
    }).catch(() => {
      // The original notes remain intact after a failed transaction.
    });
  }, [activity, current, enqueue, publish, scope, session]);

  const save = useCallback(
    (item: Activity, text: string) => {
      const key = keys.get(item.id);
      return enqueue(scope, async () => {
        const view = latest.current;
        if (
          !key ||
          !session.store ||
          view?.session !== session ||
          view.keys.get(item.id) !== key
        ) {
          throw new Error('Payment note unavailable.');
        }
        const note = {
          text: text.trim(),
          address: item.address ?? session.entries.get(key)?.address,
        };
        await session.store.save(scope, key, note);
        const entries = new Map(session.entries);
        if (note.text) entries.set(key, note);
        else entries.delete(key);
        publish(entries);
      });
    },
    [enqueue, keys, publish, scope, session],
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
