import { parsePayment } from '@beignet/wallet-core';
import {
  MAX_MESSAGE_BYTES,
  paymentUris,
  presentedUri,
  recordUri,
  uriMessage,
} from '../src/services/ndef';
import type { TapRecord } from '../src/services/ndef';
import { messageRecords, recordOf, uriRecord } from '../test-support/tap';

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

/**
 * The other way round: the message Receive presents as a tag, so a phone
 * held to this one reads its request. It is written here and read back as a
 * phone's NFC stack would take it apart, then as this wallet reads a tag.
 */
describe('the message a request is presented as', () => {
  /** The BIP 173 example address and a real invoice for 24,425 sats. */
  const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const INVOICE =
    'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
  const hex = (bytes: Uint8Array) =>
    [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(' ');

  /** What a phone that read the message would hand the scanner. */
  const readBack = (uri: string) => {
    const message = uriMessage(uri);
    expect(message).not.toBeNull();
    return paymentUris(messageRecords(message!));
  };

  test.each([
    [
      'a unified link, as the code shows it',
      `bitcoin:${ADDRESS}?amount=0.00024425&lightning=${INVOICE}`,
    ],
    ['an invoice behind its scheme', `lightning:${INVOICE}`],
    [
      'a link with a note, percent-encoded as the code has it',
      `bitcoin:${ADDRESS}?amount=0.00024425&message=Caf%C3%A9%20%26%20cr%C3%A8me&lightning=${INVOICE}`,
    ],
    [
      'a link with a funding envelope, about a kilobyte',
      `bitcoin:${ADDRESS}?amount=0.00024425&lightning=${INVOICE}&bgnq=${'A1b2'.repeat(
        200,
      )}`,
    ],
    [
      'text outside ASCII, kept byte for byte',
      'bitcoin:?message=caf\u00e9\u2615',
    ],
  ])('is read back as the same string: %s', (_, uri) => {
    expect(readBack(uri)).toEqual([uri]);
  });

  test('is one URI record and nothing else', () => {
    const records = messageRecords(uriMessage(`lightning:${INVOICE}`)!);
    expect(records).toHaveLength(1);
    expect(records[0].tnf).toBe(1);
    expect(recordUri(records[0])).toBe(`lightning:${INVOICE}`);
  });

  test('is a short record while its payload fits one byte of length, and a long one past it', () => {
    // The payload is the identifier byte and the link: 255 bytes at most
    // for the short record, which leaves the link 254.
    const short = uriMessage(`lightning:${'q'.repeat(244)}`)!;
    expect(hex(short.subarray(0, 5))).toBe('d1 01 ff 55 00');
    expect(short).toHaveLength(3 + 1 + 255);
    const long = uriMessage(`lightning:${'q'.repeat(245)}`)!;
    expect(hex(long.subarray(0, 8))).toBe('c1 01 00 00 01 00 55 00');
    expect(long).toHaveLength(6 + 1 + 256);
    expect(readBack(`lightning:${'q'.repeat(244)}`)).toHaveLength(1);
    expect(readBack(`lightning:${'q'.repeat(245)}`)).toHaveLength(1);
  });

  test('begins as a payment terminal is reported to write one', () => {
    // docs/TAP-TO-PAY.md: C1 01 00 00 01 CA 55 00, then lightning: in ASCII,
    // for a 457 character request.
    const request = `lightning:${'Q'.repeat(447)}`;
    expect(request).toHaveLength(457);
    const message = uriMessage(request)!;
    expect(message).toHaveLength(465);
    expect(hex(message.subarray(0, 18))).toBe(
      'c1 01 00 00 01 ca 55 00 6c 69 67 68 74 6e 69 6e 67 3a',
    );
  });

  test('is not written for nothing, or for more than a reader takes', () => {
    expect(uriMessage('')).toBeNull();
    // Six bytes of header, the type, the identifier, then the link.
    const most = MAX_MESSAGE_BYTES - 8;
    expect(uriMessage(`lightning:${'q'.repeat(most - 10)}`)).toHaveLength(
      MAX_MESSAGE_BYTES,
    );
    expect(uriMessage(`lightning:${'q'.repeat(most - 9)}`)).toBeNull();
    // Counted in bytes, which a note outside ASCII has more of.
    expect(
      uriMessage(`bitcoin:?message=${'\u00e9'.repeat(most / 2)}`),
    ).toBeNull();
  });

  describe('says what the code says', () => {
    test('a link is presented as it is', () => {
      const unified = `bitcoin:${ADDRESS}?amount=0.00024425&lightning=${INVOICE}`;
      expect(presentedUri(unified)).toBe(unified);
      expect(presentedUri(`BITCOIN:${ADDRESS.toUpperCase()}`)).toBe(
        `BITCOIN:${ADDRESS.toUpperCase()}`,
      );
      expect(presentedUri(`lightning:${INVOICE}`)).toBe(`lightning:${INVOICE}`);
    });

    test('a bare invoice, as the Lightning only fallback makes one, is given its scheme', () => {
      expect(presentedUri(INVOICE)).toBe(`lightning:${INVOICE}`);
      expect(presentedUri(`  ${INVOICE}\n`)).toBe(`lightning:${INVOICE}`);
    });

    test.each([
      [
        'the unified link',
        `bitcoin:${ADDRESS}?amount=0.00024425&lightning=${INVOICE}`,
      ],
      ['the bare invoice', INVOICE],
    ])(
      'and the wallet that reads it finds the same invoice: %s',
      (_, request) => {
        const [read] = readBack(presentedUri(request));
        const parsed = parsePayment(read);
        const invoice =
          parsed.kind === 'bolt11'
            ? parsed.invoice
            : parsed.kind === 'onchain' && parsed.lightning?.kind === 'bolt11'
            ? parsed.lightning.invoice
            : null;
        expect(invoice).toBe(INVOICE);
      },
    );
  });
});
