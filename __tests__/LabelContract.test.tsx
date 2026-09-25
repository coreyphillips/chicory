import ts from 'typescript';
import { copy } from '../src/design/copy';
import { filesUnder, fs, path, ROOT } from '../test-support/node';

/**
 * The accessibility labels the suites find controls by (REDESIGN.md 2.4).
 *
 * The redesign swaps worded buttons for glyphs, and a glyph that loses its
 * label fails every suite that presses it, far from the cause. This contract
 * fails first and names the label. It was recorded from the label, press,
 * field and state helpers and the findAllByProps lookups in __tests__ before
 * the redesign changed a screen.
 *
 * It is static: it proves each label is still written somewhere in App.tsx
 * or src, and the suites that press it prove it renders. A label removed on
 * purpose moves to RETIRED with its reason; entries are never deleted.
 */
const LABELS = [
  'Activity',
  'Amount in sats',
  'Change network or Bitcoin server',
  'Change primary node',
  'Choose another wallet',
  'Continue',
  'Copy request',
  'Create a wallet',
  'Create another request',
  'Create request',
  'Default Electrum port',
  'Default Electrum server',
  'Default primary node',
  'Erase wallet',
  'Erase wallet from this phone',
  'I already have a recovery phrase',
  'I saved my recovery phrase',
  'Keep my wallet',
  'Link original request',
  'Link request',
  'Lock device wallet',
  'Network settings',
  'Node address',
  'Note · optional',
  'Open device wallet',
  'Original payment request',
  'Payment request or address',
  'Receive',
  'Receive offline',
  'Recovery phrase',
  'Refresh quote',
  'Request the remaining amount',
  'Restore from recovery phrase',
  'Retry connection',
  'Retry wallet setup',
  'Review payment',
  'Reveal recovery phrase',
  'Save primary node',
  'Save your recovery phrase.',
  'Scan a payment request',
  'Send',
  'Settings',
  'Share original request',
  'Share request',
  'Try again',
  'Unlock',
  'Wallet',
];

/**
 * Labels built from data, each with the template that renders it: the words
 * around the value, with `${}` standing for each interpolation, as a template
 * literal in the source spells them.
 */
const TEMPLATES: Record<string, string> = {
  'Create mainnet wallet': 'Create ${} wallet',
  'Open First wallet': 'Open ${}',
  'Open Local mainnet': 'Open ${}',
  'Open Second wallet': 'Open ${}',
  'Restore regtest wallet': 'Restore ${} wallet',
  'Select regtest': 'Select ${}',
  'Send 4,200 sats': 'Send ${}',
  'Use regtest': 'Use ${}',
};

/**
 * Preset chips are labelled with their amount alone, so there are no words to
 * find; what they depend on is the grouping `copy.amount.preset` applies.
 */
const PRESETS = ['10,000', '50,000'];

/** Labels removed on purpose, each with the reason. */
const RETIRED: Record<string, string> = {
  Wallet:
    'The tab bar is gone. Close returns home from every scene, so no control is called Wallet.',
};

/**
 * Labels and field names the redesign tracks removed that the contract never
 * recorded, since no suite found a control by them. They are kept here with
 * their reason, apart from RETIRED, so the record of what went and why is
 * whole. Entries are never deleted.
 */
const DROPPED: Record<string, string> = {
  'View all activity':
    "Home's own activity preview is gone; the sheet's grip, 'Activity', opens the one activity list.",
  'Show balance':
    "The eye button in the status row is gone. The words name the hero's mask accessibility action, and a long press on the hero does the same.",
  'Hide balance':
    "The eye button in the status row is gone. The words name the hero's mask accessibility action, and a long press on the hero does the same.",
  'Connected.':
    'The status dot no longer speaks on its own. The mark button carries the connection in its accessibilityValue, so it is said once.',
  'Reconnecting to your wallet.':
    'The status dot no longer speaks on its own. The mark button carries the connection in its accessibilityValue, so it is said once.',
  All: 'The all payments chip is gone (REDESIGN.md 6). Tapping the chosen glyph chip again clears back to all.',
  'Back to Send':
    "The scanner's cancel link is a close glyph labelled 'Close', which is right whether the scan opened from Home or from Send.",
  'Read a payment request':
    "The Android camera permission rationale dialog is gone. Its message moved word for word into the reticle's accessibilityHint.",
  Allow:
    "The Android camera permission rationale dialog is gone. Its message moved word for word into the reticle's accessibilityHint.",
  'Not now':
    "The Android camera permission rationale dialog is gone. Its message moved word for word into the reticle's accessibilityHint.",
  Date: "A payment detail's field names are gone from the screen. Each line leads with a glyph and says its name in its accessibility props.",
  Amount:
    "A payment detail's field names are gone from the screen. Each line leads with a glyph and says its name in its accessibility props.",
  Fee: "A payment detail's field names are gone from the screen. Each line leads with a glyph and says its name in its accessibility props.",
  'Estimated fee':
    "A payment detail's field names are gone from the screen. Each line leads with a glyph and says its name in its accessibility props.",
  Status:
    "A payment detail's field names are gone from the screen. The ring says the status sentence in its label and the status in its value.",
  Note: "A payment detail's field names are gone from the screen. Each line leads with a glyph and says its name in its accessibility props.",
};

/**
 * Phrases a suite proves are gone, which no label, text or spoken string
 * may bring back (REDESIGN.md 9).
 */
const MUST_BE_ABSENT = [
  'Explore a preview',
  'Connect a host',
  'Pull to refresh',
  'Welcome back',
  'Sent, just like that.',
  'Share this request.',
];

const CONTRACT = [...LABELS, ...Object.keys(TEMPLATES), ...PRESETS];

/**
 * Every string literal, template shape and piece of JSX text in App.tsx and
 * src, read through the TypeScript parser so comments never count.
 */
function scan() {
  const literals = new Set<string>();
  const templates = new Set<string>();
  const jsxText: string[] = [];
  const files = [
    path.join(ROOT, 'App.tsx'),
    ...filesUnder(path.join(ROOT, 'src'), /\.tsx?$/),
  ];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)
      ) {
        literals.add(node.text);
      } else if (ts.isTemplateExpression(node)) {
        templates.add(
          node.head.text +
            node.templateSpans.map(span => '${}' + span.literal.text).join(''),
        );
      } else if (ts.isJsxText(node)) {
        jsxText.push(node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { literals, templates, jsxText };
}

const source = scan();
const live = (label: string) => !(label in RETIRED);

/** Whether `template` renders exactly `label`, whatever the values are. */
function renders(template: string, label: string) {
  const pattern = template
    .split('${}')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.+');
  return new RegExp(`^${pattern}$`).test(label);
}

test('the contract holds the 57 labels recorded before the redesign, once each', () => {
  expect(CONTRACT).toHaveLength(57);
  expect(new Set(CONTRACT).size).toBe(CONTRACT.length);
});

test('every fixed label is still a string literal in the app', () => {
  const missing = LABELS.filter(live).filter(
    label => !source.literals.has(label),
  );
  expect(missing).toEqual([]);
});

test('every built label still has the template that renders it', () => {
  const wrong = Object.entries(TEMPLATES).filter(
    ([label, template]) => !renders(template, label),
  );
  expect(wrong).toEqual([]);
  const missing = Object.entries(TEMPLATES)
    .filter(([label]) => live(label))
    .filter(([, template]) => !source.templates.has(template));
  expect(missing).toEqual([]);
});

test('preset chip labels are still what the amount formatter writes', () => {
  for (const label of PRESETS.filter(live)) {
    expect(copy.amount.preset(Number(label.replace(/,/g, '')))).toBe(label);
  }
});

test('only labels the contract recorded can be retired, and each says why', () => {
  for (const [label, reason] of Object.entries(RETIRED)) {
    expect(CONTRACT).toContain(label);
    expect(reason.trim()).not.toBe('');
  }
});

test('labels dropped outside the contract stay out of it, and each says why', () => {
  for (const [label, reason] of Object.entries(DROPPED)) {
    expect(CONTRACT).not.toContain(label);
    expect(reason.trim()).not.toBe('');
  }
});

const absentFrom = (texts: Iterable<string>) =>
  [...texts].filter(text =>
    MUST_BE_ABSENT.some(phrase => text.includes(phrase)),
  );

test('phrases that must never appear are nowhere in the app', () => {
  expect(
    absentFrom([...source.literals, ...source.templates, ...source.jsxText]),
  ).toEqual([]);
  expect(CONTRACT.filter(label => MUST_BE_ABSENT.includes(label))).toEqual([]);
});

test('phrases that must never appear are not in any file under src, comments included', () => {
  const files = filesUnder(path.join(ROOT, 'src'), /\.tsx?$/).filter(
    file => absentFrom([fs.readFileSync(file, 'utf8')]).length > 0,
  );
  expect(files.map(file => path.relative(ROOT, file))).toEqual([]);
});

/** Values a copy builder is tried with: words for one, amounts for another. */
const SAMPLES: unknown[][] = [
  ['First wallet', 'regtest', 'note'],
  [4200, 1000, 500],
];

/** Every string `copy` can speak, each builder tried with each sample. */
function spoken(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function') {
    return SAMPLES.flatMap(sample => {
      try {
        return [String(value(...sample))];
      } catch {
        return [];
      }
    });
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(spoken);
  }
  return [];
}

test('no string a screen reader is given says a phrase that must never appear', () => {
  const strings = spoken(copy);
  expect(strings.length).toBeGreaterThan(100);
  expect(absentFrom(strings)).toEqual([]);
  // A phrase inside a longer string still counts.
  expect(absentFrom(['Done. Pull to refresh.'])).toHaveLength(1);
});
