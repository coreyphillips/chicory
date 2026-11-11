import type { Activity } from '@beignet/wallet-core';
import {
  activityOf,
  hex,
  receiptOf,
  requestOf,
} from '../../../../test-support/fixtures';
import {
  canAnnotate,
  noteMoves,
  paymentNoteKey,
  paymentNoteKeys,
} from '../../../services/paymentNotes';
import type { PaymentNote } from '../../../services/paymentNotes';
import { activitySections } from '../model';

const txid = hex(12);
const address = requestOf().address!;
const amountSats = 8_000;
const raw = activityOf('received', 'completed', {
  id: `transaction:${txid}`,
  txid,
  address,
  amountSats,
});
const receipt = receiptOf('completed', {
  method: 'bitcoin',
  txids: [txid],
  txid,
  receivedSats: amountSats,
  confirmedSats: amountSats,
  transactions: [{ txid, amountSats, confirmed: true }],
});
const matched = activityOf('received', 'completed', {
  id: 'payment:settled',
  description: 'Original invoice memo',
  txid,
  amountSats,
  receiveRequest: requestOf({ address }),
  receiveStatus: receipt,
});
const saved = new Map<string, PaymentNote>([
  [paymentNoteKey(raw), { text: 'Dinner with Sam', address }],
]);

test('carries the raw note only onto its fully matched on-chain request', () => {
  expect(noteMoves([matched], saved)).toEqual(
    new Map([[paymentNoteKey(raw), paymentNoteKey(matched)]]),
  );
  const partial = { ...raw, amountSats: 1_000 };
  const secondRequest = {
    ...matched,
    id: 'second-request',
    receiveRequest: requestOf({}, 2),
  };
  for (const rows of [
    [partial, matched],
    [matched, secondRequest],
    [
      {
        ...matched,
        receiveRequest: requestOf({ bitcoinTracking: 'ambiguous' }),
      },
    ],
    [{ ...matched, receiveRequest: requestOf({}, 2) }],
    [{ ...matched, receiveStatusUnavailable: true }],
    [{ ...matched, receiveStatus: { ...receipt, txids: [txid, hex(20)] } }],
    [
      {
        ...matched,
        receiveStatus: {
          ...receipt,
          transactions: [
            ...receipt.transactions!,
            { txid: hex(20), confirmed: true, amountSats: 500 },
          ],
        },
      },
    ],
  ])
    expect(noteMoves(rows, saved).size).toBe(0);
  const sameRemainder = paymentNoteKeys([partial, secondRequest]).get(
    partial.id,
  );
  expect(paymentNoteKeys([partial, matched]).get(partial.id)).not.toEqual(
    sameRemainder,
  );
  expect(
    noteMoves(
      [matched],
      new Map([[sameRemainder!, { text: 'Batch remainder' }]]),
    ),
  ).toEqual(new Map());
  expect(
    noteMoves(
      [matched],
      new Map([[paymentNoteKey(raw), { text: 'Whole receipt' }]]),
    ),
  ).toEqual(new Map([[paymentNoteKey(raw), paymentNoteKey(matched)]]));
  expect(paymentNoteKey(partial)).not.toEqual(paymentNoteKey(raw));
  expect(paymentNoteKey({ ...raw, address: undefined })).toBe(
    paymentNoteKey(raw),
  );
  expect(
    noteMoves(
      [matched],
      new Map([...saved, [paymentNoteKey(matched), { text: 'Already named' }]]),
    ).size,
  ).toBe(0);
});

test('the row uses the personal note and both it and the original memo remain searchable', () => {
  const notes = new Map([
    [paymentNoteKey(matched), { text: 'Dinner with Sam', address }],
  ]);
  const search = (filter: string, needle: string) =>
    activitySections(
      [matched],
      filter,
      needle.trim().toLowerCase(),
      notes,
    ).filter(row => row.kind === 'item');
  for (const needle of ['   SAM ', 'original invoice']) {
    expect(search('Received', needle)).toEqual([
      expect.objectContaining({
        item: matched,
        privateNote: 'Dinner with Sam',
      }),
    ]);
  }
  expect(search('Sent', 'Sam')).toEqual([]);
  expect(matched.description).toBe('Original invoice memo');
  expect(activitySections([matched], 'All', 'sam')).toEqual([]);
});

test('only settled incoming and outgoing payments can carry notes', () => {
  expect(canAnnotate(raw)).toBe(true);
  expect(canAnnotate(activityOf('sent', 'completed'))).toBe(true);
  for (const row of [
    activityOf('sent', 'pending'),
    activityOf('sent', 'uncertain'),
    activityOf('sent', 'failed'),
    activityOf('request', 'expired'),
    activityOf('transfer', 'completed'),
    { ...matched, receiveStatus: receiptOf('partial') },
  ] satisfies Activity[])
    expect(canAnnotate(row)).toBe(false);
});
