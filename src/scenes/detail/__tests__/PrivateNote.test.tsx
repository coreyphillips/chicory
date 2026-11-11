import React from 'react';
import { FlatList, TextInput } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { Activity } from '@beignet/wallet-core';
import {
  activityOf,
  receiptOf,
  requestOf,
  hex,
  walletOf,
  snapshotOf,
} from '../../../../test-support/fixtures';
import { copy } from '../../../design/copy';
import { ActivityScreen } from '../../../screens/wallet/Activity';
import { DetailScreen } from '../../../screens/wallet/Detail';
import type {
  PaymentNote,
  PaymentNoteStore,
} from '../../../services/paymentNotes';
import {
  StageProvider,
  newestFirst,
  useStageStore,
} from '../../../stage/StageContext';
import type { StageStore } from '../../../stage/StageContext';
import { WalletNotesProvider } from '../../activity/WalletNotes';
import { GlyphButton } from '../../receive/controls';

const sent = activityOf('sent', 'completed', {
  description: 'Original coffee invoice',
});
const received = activityOf('received', 'completed', { seed: 3 });
const records = new Map<string, Map<string, PaymentNote>>();
const store: PaymentNoteStore = {
  read: scope => new Map(records.get(scope)),
  save(scope, key, note) {
    const entries = records.get(scope) ?? new Map<string, PaymentNote>();
    if (note.text) entries.set(key, note);
    else entries.delete(key);
    records.set(scope, entries);
  },
  move(scope, moves) {
    const entries = records.get(scope)!;
    for (const [from, to] of moves) {
      entries.set(to, entries.get(from)!);
      entries.delete(from);
    }
  },
};
const open = () => store;
let stage: StageStore;
function Screen({
  item,
  walletId = 'first',
  query,
}: {
  item: Activity;
  walletId?: string;
  query?: string;
}) {
  stage = useStageStore();
  return (
    <StageProvider value={stage}>
      <WalletNotesProvider
        open={open}
        wallet={walletOf({ id: walletId })}
        activity={[item]}
      >
        {query !== undefined && (
          <GestureHandlerRootView>
            <ActivityScreen
              snapshot={snapshotOf({ activity: [item] })}
              filter="Sent"
              query={query}
              onDetail={jest.fn()}
              onFilter={jest.fn()}
            />
          </GestureHandlerRootView>
        )}
        <DetailScreen item={item} />
      </WalletNotesProvider>
    </StageProvider>
  );
}
let tree: ReactTestRenderer;
const buttons = () => tree.root.findAllByType(GlyphButton);
function action(label: string) {
  return buttons().find(button => button.props.label === label)!.props
    .onPress as () => void;
}
const press = async (label: string) => {
  await act(async () => action(label)());
};
const type = async (s: string) => {
  await act(async () => tree.root.findByType(TextInput).props.onChangeText(s));
};
const shows = (label: string) =>
  tree.root.findAllByProps({ accessibilityLabel: label }).length > 0;
async function mount(item: Activity) {
  await act(async () => {
    tree = create(<Screen item={item} />);
  });
}
afterEach(async () => {
  await act(async () => tree.unmount());
  records.clear();
  jest.restoreAllMocks();
});

test.each([sent, received])(
  'edit, cancel, retry and remove a note on a $kind payment',
  async item => {
    await mount(item);
    await press(copy.detail.addNote);
    expect(tree.root.findByType(TextInput).props.autoFocus).toBe(true);
    await type('  Lunch with Sam  ');
    jest.spyOn(store, 'save').mockImplementationOnce(() => {
      throw new Error('write failed');
    });
    await press(copy.detail.saveNote);
    expect(tree.root.findByType(TextInput).props.value).toBe(
      '  Lunch with Sam  ',
    );
    expect(shows(copy.detail.noteFailed)).toBe(true);
    await press(copy.detail.saveNote);
    expect(shows(copy.detail.privateValue('Lunch with Sam'))).toBe(true);
    if (item.description)
      expect(shows(copy.detail.note(item.description))).toBe(true);
    await press(copy.detail.editNote);
    await type('An unsaved edit');
    const late = action(copy.detail.saveNote);
    await press(copy.detail.cancelNote);
    await act(async () => late());
    expect(shows(copy.detail.privateValue('Lunch with Sam'))).toBe(true);

    await press(copy.detail.editNote);
    await type('Changed my mind');
    await act(async () => {
      expect(newestFirst(stage.responders.sceneBack)[0]()).toBe(true);
    });
    expect(shows(copy.detail.privateValue('Lunch with Sam'))).toBe(true);
    await press(copy.detail.editNote);
    await type('Escape this edit');
    await act(async () =>
      tree.root
        .findByType(TextInput)
        .props.onKeyPress({ nativeEvent: { key: 'Escape' } }),
    );
    expect(shows(copy.detail.privateValue('Lunch with Sam'))).toBe(true);
    await press(copy.detail.editNote);
    await type('Paid for dinner');
    await press(copy.detail.saveNote);
    expect(shows(copy.detail.privateValue('Paid for dinner'))).toBe(true);
    await press(copy.detail.editNote);
    await type('  ');
    await press(copy.detail.saveNote);
    expect(buttons().some(b => b.props.label === copy.detail.addNote)).toBe(
      true,
    );
    expect(shows(copy.detail.privateValue('Paid for dinner'))).toBe(false);
  },
);

test('wallet switches discard the editor, reject a late tap and reload only the selected wallet', async () => {
  await mount(sent);
  await press(copy.detail.addNote);
  await type('First wallet only');
  await press(copy.detail.saveNote);
  await press(copy.detail.editNote);
  await type('Late write');
  const stale = action(copy.detail.saveNote);
  await act(async () =>
    tree.update(<Screen item={{ ...sent }} walletId="second" />),
  );
  await act(async () => stale());
  expect(shows(copy.detail.privateValue('First wallet only'))).toBe(false);
  expect(buttons().some(b => b.props.label === copy.detail.addNote)).toBe(true);
  await act(async () => tree.update(<Screen item={{ ...sent }} />));
  expect(shows(copy.detail.privateValue('First wallet only'))).toBe(true);
  await act(async () =>
    tree.update(<Screen item={{ ...sent, status: 'uncertain' }} />),
  );
  expect(
    buttons().some(b =>
      [copy.detail.addNote, copy.detail.editNote].includes(b.props.label),
    ),
  ).toBe(false);
});

test('moves a saved raw receive note onto a verified request, rejects its old editor and reopens', async () => {
  const txid = hex(42);
  const amountSats = 4200;
  const request = requestOf({ amountSats });
  const raw = activityOf('received', 'completed', {
    id: `transaction:${txid}`,
    txid,
    address: request.address,
    amountSats,
  });
  const matched = activityOf('received', 'completed', {
    id: 'payment:matched',
    txid,
    amountSats,
    receiveRequest: request,
    receiveStatus: receiptOf('completed', {
      method: 'bitcoin',
      txids: [txid],
      txid,
      receivedSats: amountSats,
      confirmedSats: amountSats,
      transactions: [{ txid, amountSats, confirmed: true }],
    }),
  });
  await mount(raw);
  await press(copy.detail.addNote);
  await type('Lunch');
  await press(copy.detail.saveNote);
  await press(copy.detail.editNote);
  await type('Stale draft');
  const stale = action(copy.detail.saveNote);
  await act(async () => tree.update(<Screen item={matched} />));
  await act(async () => stale());
  expect(shows(copy.detail.privateValue('Lunch'))).toBe(true);
  await act(async () => tree.unmount());
  await mount(matched);
  expect(shows(copy.detail.privateValue('Lunch'))).toBe(true);
});

test('an open Activity search follows saves and deletions while the original memo stays searchable', async () => {
  const row = () =>
    tree.root
      .findAllByType(FlatList)[0]
      ?.props.data.find((r: { kind: string }) => r.kind === 'item');
  await act(async () => {
    tree = create(<Screen item={sent} query="  sAm  " />);
  });
  expect(row()).toBeUndefined();
  await press(copy.detail.addNote);
  await type('Dinner with Sam');
  await press(copy.detail.saveNote);
  expect(row()).toMatchObject({ privateNote: 'Dinner with Sam', item: sent });
  await press(copy.detail.editNote);
  await type('');
  await press(copy.detail.saveNote);
  expect(row()).toBeUndefined();
  await act(async () => tree.update(<Screen item={sent} query="  COFfee " />));
  expect(row()?.item).toBe(sent);
});
