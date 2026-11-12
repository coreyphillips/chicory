import { paymentUris, recordUri } from '../src/services/ndef';
import type { TapRecord } from '../src/services/ndef';
import { recordOf, uriRecord } from '../test-support/tap';

/**
 * What a tag's records say (docs/TAP-TO-PAY.md). The phone's NFC stack has
 * already read the tag and split it into records, so these start from
 * records, as native code hands them over.
 */

/** An invoice as long as a real one, in capitals as a till's QR writes it. */
const LONG_INVOICE = `LNTBS79900N1P5HGY5X${'QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L'.repeat(
  14,
)}`;

describe('a URI record', () => {
  test('is read whole, as a till writes it: nothing abbreviated, capitals kept', () => {
    const uri = `lightning:${LONG_INVOICE}`;
    // Past 255 bytes, where a tag switches to its long record format. The
    // phone takes that apart; what reaches here is the payload either way.
    expect(uri.length).toBeGreaterThan(255);
    expect(recordUri(uriRecord(uri))).toBe(uri);
  });

  test.each([
    ['bitcoin:?lightning=LNBC1INVOICE'],
    ['bitcoin:?LIGHTNING=LNBC1INVOICE'],
    ['BITCOIN:?LIGHTNING=LNBC1INVOICE'],
    ['bitcoin:BC1QEXAMPLE?amount=0.001&lightning=lnbc1invoice'],
  ])('carries the BIP 321 form as written: %s', uri => {
    expect(recordUri(uriRecord(uri))).toBe(uri);
  });

  test("has its first byte's abbreviation written out", () => {
    expect(recordUri(uriRecord('example.com/pay', 1))).toBe(
      'http://www.example.com/pay',
    );
    expect(recordUri(uriRecord('example.com/pay', 4))).toBe(
      'https://example.com/pay',
    );
    expect(recordUri(uriRecord('nobody@example.com', 6))).toBe(
      'mailto:nobody@example.com',
    );
    expect(recordUri(uriRecord('ndef', 35))).toBe('urn:nfc:ndef');
  });

  test('with a reserved first byte says nothing', () => {
    expect(recordUri(uriRecord('lightning:LNBC1INVOICE', 36))).toBeNull();
    expect(recordUri(uriRecord('lightning:LNBC1INVOICE', 255))).toBeNull();
  });

  test('written as an absolute URI record is read from its type', () => {
    expect(recordUri(recordOf(3, 'lightning:LNBC1INVOICE', []))).toBe(
      'lightning:LNBC1INVOICE',
    );
  });

  test('that is empty, or is not text, says nothing', () => {
    // Only the first byte, and nothing after it.
    expect(recordUri(recordOf(1, 'U', [0]))).toBeNull();
    expect(recordUri(recordOf(1, 'U', []))).toBeNull();
    // 0xC3 opens a two byte character that 0x28 does not finish.
    expect(recordUri(recordOf(1, 'U', [0, 0xc3, 0x28]))).toBeNull();
    expect(recordUri(recordOf(3, [0xff, 0xfe], []))).toBeNull();
  });
});

describe('a record of another kind', () => {
  test.each<[string, TapRecord]>([
    ['a text record', recordOf(1, 'T', '\u0002enlightning:LNBC1INVOICE')],
    [
      'a smart poster, whose link is a level down',
      recordOf(1, 'Sp', [0xd1, 0x01, 0x04, 0x55, 0x00, 0x61, 0x62, 0x63]),
    ],
    ['a MIME record', recordOf(2, 'text/plain', 'lightning:LNBC1INVOICE')],
    ['an app record', recordOf(4, 'android.com:pkg', 'lightning:LNBC1INVOICE')],
    ['an empty record', recordOf(0, [], [])],
    ['an unknown record', recordOf(5, [], 'lightning:LNBC1INVOICE')],
  ])('is not a link: %s', (_, record) => {
    expect(recordUri(record)).toBeNull();
    expect(paymentUris([record])).toEqual([]);
  });

  test('that is not a record at all is passed over', () => {
    for (const broken of [
      null,
      undefined,
      {},
      { tnf: 1, type: 5, payload: 'AA==' },
      { tnf: 1, type: 'VQ==' },
      { tnf: '1', type: 'VQ==', payload: 'AGxpZ2h0bmluZzpsbmJjMQ==' },
    ]) {
      expect(recordUri(broken as never)).toBeNull();
    }
    expect(paymentUris(null as never)).toEqual([]);
    expect(paymentUris('lightning:LNBC1INVOICE' as never)).toEqual([]);
  });

  test('whose base64 is not base64 says nothing', () => {
    expect(
      recordUri({ tnf: 1, type: '!!!!', payload: '\u0000\u0001' }),
    ).toBeNull();
  });
});

describe("the payment links among a tag's records", () => {
  test('are the lightning: and bitcoin: ones, in any case, as written', () => {
    const records = [
      uriRecord(`lightning:${LONG_INVOICE}`),
      uriRecord('BITCOIN:?LIGHTNING=LNBC1INVOICE'),
      uriRecord('LIGHTNING:lnbc1invoice'),
      uriRecord('bitcoin:bc1qexample'),
    ];
    expect(paymentUris(records)).toEqual([
      `lightning:${LONG_INVOICE}`,
      'BITCOIN:?LIGHTNING=LNBC1INVOICE',
      'LIGHTNING:lnbc1invoice',
      'bitcoin:bc1qexample',
    ]);
  });

  test('leave out every other link, and what only looks like one', () => {
    expect(
      paymentUris([
        uriRecord('example.com/lightning:LNBC1INVOICE', 4),
        uriRecord('lnurl1dp68gurn8ghj7um9'),
        uriRecord('bitcoincash:qexample'),
        uriRecord('lightning'),
        uriRecord('tel:5550100'),
        recordOf(1, 'T', '\u0002enlightning:LNBC1INVOICE'),
      ]),
    ).toEqual([]);
  });

  test('lose the space round them and nothing else', () => {
    expect(paymentUris([uriRecord('  lightning:LNBC1INVOICE\n')])).toEqual([
      'lightning:LNBC1INVOICE',
    ]);
  });

  test('are none for a tag with no records', () => {
    expect(paymentUris([])).toEqual([]);
  });

  test('keep a request written twice, for the scanner to count as one', () => {
    const twice = [
      uriRecord('lightning:LNBC1INVOICE'),
      uriRecord('lightning:LNBC1INVOICE'),
    ];
    expect(paymentUris(twice)).toHaveLength(2);
  });
});
