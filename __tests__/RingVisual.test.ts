import type {
  Activity,
  PaymentStatus,
  ReceiveRequestDetails,
  ReceiveStatus,
} from '@beignet/wallet-core';
import { GLYPHS } from '../src/design/glyphs';
import {
  RAIL_GLYPH,
  amountVisual,
  railOf,
  ringFlags,
  ringVisual,
} from '../src/scenes/activity/visual';
import type { AmountVisual, RingVisual } from '../src/scenes/activity/visual';

/**
 * The activity ring table (REDESIGN.md 6). A payment's ring is often all it
 * says, so every state gets its own and the unknown outcome can never be
 * mistaken for a finished one.
 */
const KINDS: Activity['kind'][] = ['sent', 'received', 'request', 'transfer'];
const STATUSES: PaymentStatus[] = [
  'completed',
  'pending',
  'uncertain',
  'failed',
  'expired',
];
const TONES = ['bloom', 'sage', 'honey', 'radish', 'dust', 'steam'];
const PATTERNS = ['full', 'orbit', 'dashed', 'split', 'held', 'gap', 'expired'];

const item = (over: Partial<Activity> = {}): Activity => ({
  id: 'a',
  kind: 'sent',
  title: 'Payment',
  description: '',
  amountSats: 5000,
  feeSats: 1,
  status: 'completed',
  timestamp: 1_700_000_000_000,
  reference: '',
  ...over,
});

const request = (
  over: Partial<ReceiveRequestDetails> = {},
): ReceiveRequestDetails => ({
  id: 'r',
  uri: 'bitcoin:bcrt1q?amount=0.0001',
  bolt11: 'lnbcrt1',
  paymentHash: 'h',
  amountSats: 10_000,
  description: '',
  feeSats: 0,
  expiresAt: 0,
  warnings: [],
  demo: false,
  ...over,
});

const receipt = (over: Partial<ReceiveStatus>): ReceiveStatus => ({
  phase: 'waiting',
  receivedSats: 0,
  confirmedSats: 0,
  pendingSats: 0,
  txids: [],
  ...over,
});

const every = KINDS.flatMap(kind => STATUSES.map(status => ({ kind, status })));

test('every kind in every status has a ring drawn from the table', () => {
  for (const { kind, status } of every) {
    const ring = ringVisual(item({ kind, status }));
    expect(TONES).toContain(ring.tone);
    expect(PATTERNS).toContain(ring.pattern);
    expect(Object.keys(GLYPHS)).toContain(ring.glyph);
  }
});

describe('the rows of the table', () => {
  test.each<[string, Partial<Activity>, RingVisual]>([
    [
      'completed sent',
      { kind: 'sent' },
      { tone: 'steam', pattern: 'full', glyph: 'send' },
    ],
    [
      'completed received',
      { kind: 'received' },
      { tone: 'sage', pattern: 'full', glyph: 'receive' },
    ],
    [
      'a paid request',
      { kind: 'request' },
      { tone: 'sage', pattern: 'full', glyph: 'receive' },
    ],
    [
      'completed transfer',
      { kind: 'transfer' },
      { tone: 'steam', pattern: 'full', glyph: 'swap' },
    ],
    [
      'pending send',
      { kind: 'sent', status: 'pending' },
      { tone: 'bloom', pattern: 'orbit', glyph: 'send' },
    ],
    [
      'pending transfer',
      { kind: 'transfer', status: 'pending' },
      { tone: 'bloom', pattern: 'orbit', glyph: 'swap' },
    ],
    [
      'request waiting',
      { kind: 'request', status: 'pending', receiveRequest: request() },
      { tone: 'bloom', pattern: 'dashed', glyph: 'qr' },
    ],
    [
      'offline request waiting',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request({ offlineReceive: true }),
      },
      { tone: 'bloom', pattern: 'dashed', glyph: 'moon' },
    ],
    [
      'received, confirming',
      { kind: 'received', status: 'pending' },
      { tone: 'sage', pattern: 'orbit', glyph: 'receive' },
    ],
    [
      'request paid on-chain, confirming',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request(),
        receiveStatus: receipt({
          phase: 'pending',
          receivedSats: 10_000,
          confirmedSats: 2_500,
        }),
      },
      { tone: 'sage', pattern: 'orbit', progress: 0.25, glyph: 'receive' },
    ],
    [
      'partly paid',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request(),
        receiveStatus: receipt({ phase: 'partial', receivedSats: 4_000 }),
      },
      { tone: 'sage', pattern: 'split', split: 0.4, glyph: 'receive' },
    ],
    [
      'uncertain',
      { kind: 'sent', status: 'uncertain' },
      { tone: 'honey', pattern: 'held', glyph: 'pause' },
    ],
    [
      'failed',
      { kind: 'sent', status: 'failed' },
      { tone: 'radish', pattern: 'full', glyph: 'cross' },
    ],
    [
      'expired',
      { kind: 'request', status: 'expired', receiveRequest: request() },
      { tone: 'dust', pattern: 'expired', glyph: 'qr' },
    ],
    [
      'status unavailable',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request(),
        receiveStatusUnavailable: true,
      },
      { tone: 'steam', pattern: 'gap', glyph: 'question' },
    ],
    [
      'address reused',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
      },
      { tone: 'honey', pattern: 'full', glyph: 'twin' },
    ],
    [
      'a legacy request',
      {
        kind: 'request',
        status: 'expired',
        receiveRequest: request({ legacy: true }),
      },
      { tone: 'dust', pattern: 'expired', glyph: 'qr', badge: 'chain' },
    ],
  ])('%s', (_name, over, ring) => {
    expect(ringVisual(item(over))).toEqual(ring);
  });
});

test('an unknown outcome outranks every other thing a payment can say', () => {
  const held = { tone: 'honey', pattern: 'held', glyph: 'pause' };
  for (const kind of KINDS) {
    expect(
      ringVisual(
        item({
          kind,
          status: 'uncertain',
          receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
          receiveStatus: receipt({ phase: 'partial', receivedSats: 1 }),
          receiveStatusUnavailable: true,
        }),
      ),
    ).toEqual(held);
  }
});

test('uncertain never shares its pattern or its tone with a completed state', () => {
  const completed = [
    ...KINDS.map(kind => item({ kind })),
    item({
      kind: 'request',
      receiveRequest: request({ legacy: true }),
      receiveStatus: receipt({ phase: 'completed', receivedSats: 10_000 }),
    }),
    item({
      kind: 'received',
      receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
    }),
  ].map(ringVisual);
  for (const kind of KINDS) {
    const uncertain = ringVisual(item({ kind, status: 'uncertain' }));
    for (const done of completed) {
      expect(uncertain.pattern).not.toBe(done.pattern);
      expect(uncertain.tone).not.toBe(done.tone);
    }
  }
});

test('the safety states each have a shape of their own', () => {
  const shapes = [
    item({ status: 'uncertain' }),
    item({ status: 'failed' }),
    item({ kind: 'request', status: 'expired' }),
    item({
      kind: 'request',
      status: 'pending',
      receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
    }),
    item({
      kind: 'request',
      status: 'pending',
      receiveRequest: request(),
      receiveStatus: receipt({ phase: 'partial', receivedSats: 1 }),
    }),
  ]
    .map(ringVisual)
    .map(ring => `${ring.pattern}/${ring.glyph}`);
  expect(new Set(shapes).size).toBe(shapes.length);
});

test('a completed payment is not held up by a flag that no longer matters', () => {
  expect(
    ringVisual(
      item({
        kind: 'received',
        receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
        receiveStatusUnavailable: true,
      }),
    ),
  ).toEqual({ tone: 'sage', pattern: 'full', glyph: 'receive' });
});

describe('the rail a payment took', () => {
  test.each<[string, Partial<Activity>, string]>([
    ['a Lightning payment', { id: 'payment:ab' }, 'bolt'],
    ['a transaction', { id: 'transaction:cd' }, 'chain'],
    [
      'a submitted Lightning send',
      { id: 'submission:1', paymentHash: 'h' },
      'bolt',
    ],
    [
      'a submitted direct funding',
      { id: 'submission:2', txid: 't', title: 'Direct funding sent' },
      'fund',
    ],
    ['a submitted on-chain send', { id: 'submission:3', txid: 't' }, 'chain'],
    [
      'a request paid on chain',
      {
        id: 'payment:ef',
        kind: 'request',
        receiveStatus: receipt({ phase: 'pending', method: 'bitcoin' }),
      },
      'chain',
    ],
    [
      'a request paid over Lightning',
      {
        id: 'request-1',
        kind: 'received',
        receiveStatus: receipt({ phase: 'completed', method: 'lightning' }),
      },
      'bolt',
    ],
  ])('%s', (_name, over, rail) => {
    expect(railOf(item(over))).toBe(rail);
  });

  test('every rail has a glyph', () => {
    for (const glyph of Object.values(RAIL_GLYPH)) {
      expect(Object.keys(GLYPHS)).toContain(glyph);
    }
  });
});

describe('how a row sets its amount', () => {
  test.each<[string, Partial<Activity>, AmountVisual]>([
    [
      'money in',
      { kind: 'received' },
      { tone: 'sage', weight: '600', sign: '+', open: false, struck: false },
    ],
    [
      'money out',
      { kind: 'sent' },
      { tone: 'cream', weight: '400', sign: '−', open: false, struck: false },
    ],
    [
      'a transfer',
      { kind: 'transfer' },
      { tone: 'cream', weight: '400', sign: '', open: false, struck: false },
    ],
    [
      'a request',
      { kind: 'request', status: 'pending', receiveRequest: request() },
      { tone: 'steam', weight: '400', sign: '', open: false, struck: false },
    ],
    [
      'a request for any amount',
      {
        kind: 'request',
        status: 'pending',
        receiveRequest: request({ amountSats: null }),
      },
      { tone: 'steam', weight: '400', sign: '', open: true, struck: false },
    ],
    [
      'a failed send',
      { kind: 'sent', status: 'failed' },
      { tone: 'dust', weight: '400', sign: '−', open: false, struck: true },
    ],
    [
      'an expired request',
      { kind: 'request', status: 'expired', receiveRequest: request() },
      { tone: 'dust', weight: '400', sign: '', open: false, struck: true },
    ],
  ])('%s', (_name, over, look) => {
    expect(amountVisual(item(over))).toEqual(look);
  });

  test('an unknown outcome is never set as money that arrived', () => {
    for (const kind of KINDS) {
      const look = amountVisual(item({ kind, status: 'uncertain' }));
      expect(look.struck).toBe(false);
      expect(look.tone === 'sage').toBe(kind === 'received');
    }
  });
});

test('what a ring adds beyond the status word is said aloud', () => {
  const flags = (over: Partial<Activity>) => ringFlags(ringVisual(item(over)));
  expect(flags({})).toEqual([]);
  expect(
    flags({
      kind: 'request',
      status: 'pending',
      receiveRequest: request({ bitcoinTracking: 'ambiguous' }),
    }),
  ).toEqual(['Address reused']);
  expect(
    flags({
      kind: 'request',
      status: 'pending',
      receiveRequest: request(),
      receiveStatusUnavailable: true,
    }),
  ).toEqual(['Status unavailable']);
  expect(
    flags({
      kind: 'request',
      status: 'expired',
      receiveRequest: request({ legacy: true }),
    }),
  ).toEqual(['Older request']);
});
