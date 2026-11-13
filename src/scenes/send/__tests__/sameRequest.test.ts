import { sameRequest } from '../sameRequest';

/**
 * Whether two codes ask for one payment (docs/TAP-TO-PAY.md): what a chosen
 * image or a tag with two codes in it is held to, and what a link is held to
 * against the Send already open.
 */

/** A real invoice for 24,425 sats, from the send suite. */
const INVOICE =
  'lnbc244250n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqw53adf';
const CAPITALS = INVOICE.toUpperCase();
/** The BOLT 11 examples: one for 250,000 sats, and one that names no amount. */
const COFFEE =
  'lnbc2500u1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpu9qrsgquk0rl77nj30yxdy8j9vdx85fkpmdla2087ne0xh8nhedh8w27kyke0lp53ut353s06fv3qfegext0eh0ymjpf39tuven09sam30g4vgpfna3rh';
const DONATION =
  'lnbc1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdpl2pkx2ctnv5sxxmmwwd5kgetjypeh2ursdae8g6twvus8g6rfwvs8qun0dfjkxaq9qrsgq357wnc5r2ueh7ck6q93dj32dlqnls087fxdwk8qakdyafkq3yap9us6v52vjjsrvywa6rt52cm9r9zqt8r2t7mlcwspyetp5h2tztugp9lfyql';
/** The BIP 173 example addresses. */
const A = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const B = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3';
const PUBKY = '5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo';
const OFFER = 'lno1qcp4256ypq';
const LNURL =
  'lnurl1dp68gurn8ghj7um9wfmxjcm99e3k7mf0v9cxj0m385ekvcenxc6r2c35xvukxefcv5mkvv34x5ekzd3ev56nyd3hxqurzepexejxxepnxscrvwfnv9nxzcn9xq6xyefhvgcxxcmyxymnserxfq5fns';

test.each<[string, string, string]>([
  ['in capitals', INVOICE, CAPITALS],
  ['behind lightning:', INVOICE, `lightning:${CAPITALS}`],
  [
    'behind lightning: and inside a bitcoin: link with no address',
    `lightning:${INVOICE}`,
    `bitcoin:?lightning=${INVOICE}`,
  ],
  [
    'all in capitals, field name and all',
    `BITCOIN:?LIGHTNING=${CAPITALS}`,
    INVOICE,
  ],
  [
    'alone and beside an address, where the link only says more of it',
    INVOICE,
    `bitcoin:${A}?lightning=${INVOICE}`,
  ],
  [
    'beside an address, with the amount written out and left to the invoice',
    `bitcoin:${A}?amount=0.00024425&lightning=${INVOICE}`,
    `bitcoin:${A}?lightning=${INVOICE}`,
  ],
  ['an address bare and as a link', A, `bitcoin:${A}`],
  [
    'an amount with and without its trailing zero',
    `bitcoin:${A}?amount=0.0001`,
    `bitcoin:${A}?amount=0.00010`,
  ],
  [
    'an address and amount in capitals',
    `bitcoin:${A}?amount=0.0001`,
    `BITCOIN:${A.toUpperCase()}?AMOUNT=0.0001`,
  ],
  [
    'under two labels, which are words about it',
    `bitcoin:${A}?amount=0.0001&label=one`,
    `bitcoin:${A}?amount=0.0001&label=two`,
  ],
  [
    'an address with and without a lightning= that holds no invoice',
    `bitcoin:${A}?lightning=broken`,
    `bitcoin:${A}`,
  ],
  ['an offer bare and behind lightning:', OFFER, `lightning:${OFFER}`],
  ['a pubky bare and with its scheme', PUBKY, `pubky://${PUBKY}`],
  ['the same text with space round it', `  ${LNURL}`, `${LNURL}\n`],
])('one payment, however it is spelled: %s', (_, a, b) => {
  expect(sameRequest(a, b)).toBe(true);
  expect(sameRequest(b, a)).toBe(true);
});

test.each<[string, string, string]>([
  ['two invoices', INVOICE, COFFEE],
  [
    'one invoice beside two addresses',
    `bitcoin:${A}?lightning=${INVOICE}`,
    `bitcoin:${B}?lightning=${INVOICE}`,
  ],
  [
    // The parser passes over a lightning= it cannot read, so these are two
    // addresses and nothing else. Their text names the same "invoice".
    'two addresses beside the same unreadable lightning=',
    `bitcoin:${A}?lightning=broken`,
    `bitcoin:${B}?lightning=broken`,
  ],
  [
    'two addresses beside the same unreadable lightning=, amounts and all',
    `bitcoin:${A}?amount=0.0001&lightning=broken`,
    `bitcoin:${B}?amount=0.0001&lightning=broken`,
  ],
  ['two addresses', A, B],
  [
    'one address for two amounts',
    `bitcoin:${A}?amount=0.0001`,
    `bitcoin:${A}?amount=0.0002`,
  ],
  ['an address with an amount and without', `bitcoin:${A}?amount=0.0001`, A],
  ['an address and an invoice', A, INVOICE],
  [
    'an address alone and beside an invoice',
    A,
    `bitcoin:${A}?lightning=${INVOICE}`,
  ],
  [
    'an invoice that names no amount, alone and beside one that fixes it',
    DONATION,
    `bitcoin:${A}?amount=0.0001&lightning=${DONATION}`,
  ],
  ['an invoice and an offer', INVOICE, OFFER],
  ['a pubky and an address', PUBKY, A],
  ['two things this wallet cannot read', LNURL, `lightning:${LNURL}`],
  ['a request and nothing', INVOICE, ''],
])('two requests: %s', (_, a, b) => {
  expect(sameRequest(a, b)).toBe(false);
  expect(sameRequest(b, a)).toBe(false);
});
