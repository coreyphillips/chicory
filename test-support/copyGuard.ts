/**
 * The copy guard: REDESIGN.md rule 1 as a check over a rendered tree.
 *
 * Outside Settings, the screen may show data and nothing else: amounts and
 * their units, dates, recovery words, request strings, wallet names and
 * notes. Words that explain belong in accessibility props, where the guard
 * does not look. Settings and the settings-class surfaces (rule 2) are the
 * places prose may stay, so each root carries a marker and the guard skips
 * everything under it.
 */
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { componentPath, ownText } from './query';

/**
 * The testID a settings-class root renders: the settings scene, the new
 * wallet sheet and a phase's setup panel. Only one is ever drawn at a time.
 */
export const SETTINGS_MARKER = 'scene-settings';

export interface CopyViolation {
  /** The string on screen. */
  text: string;
  /** The composite components above it, outermost first. */
  path: string;
}

/**
 * Strings that are data by their shape: an amount with an optional sign and
 * unit, a bare unit, the balance mask, a countdown, and runs of separators or
 * math signs.
 */
const SHAPES = [
  /^[+\-−]?\s?[\d,]+(\.\d{1,8})?(\s?(sats?|BTC|₿))?$/,
  /^(sats?|BTC|₿)$/,
  /^•+$/,
  /^\d{1,2}:\d{2}$/,
  /^[\s·•,.:+\-−=≈≤∞]*$/,
];

/** Visible props that hold text of their own. */
const TEXT_PROPS = ['placeholder', 'title'];

const isMarker = (node: ReactTestInstance) =>
  typeof node.type === 'string' && node.props.testID === SETTINGS_MARKER;

/**
 * Every string on screen outside Settings that is not data, with where it
 * was drawn.
 *
 * `data` lists the strings the state was rendered with that are data by
 * content rather than shape: formatter output such as dates, and fixture
 * values such as wallet names, notes, request strings, txids and recovery
 * words. A string passes only when it is exactly one of them, so a label that
 * merely contains a wallet name still fails.
 *
 * Throws when the tree holds more than one settings marker, since a second one
 * would switch the guard off for a surface that is not settings-class.
 */
export function copyViolations(
  tree: ReactTestRenderer,
  { data }: { data: string[] },
): CopyViolation[] {
  const markers = tree.root.findAll(isMarker);
  if (markers.length > 1) {
    const where = markers.map(componentPath).join('; ');
    throw new Error(
      `Found ${markers.length} "${SETTINGS_MARKER}" markers, at ${where}. Only one settings-class surface is drawn at a time.`,
    );
  }
  const allowed = new Set(data);
  const out: CopyViolation[] = [];
  const walk = (node: ReactTestInstance) => {
    if (isMarker(node)) return;
    const shown = ownText(node.children);
    if (typeof node.type === 'string') {
      for (const name of TEXT_PROPS) {
        const value = node.props[name];
        if (typeof value === 'string' && value.trim()) shown.push(value.trim());
      }
    }
    for (const text of shown) {
      if (!allowed.has(text) && !SHAPES.some(shape => shape.test(text))) {
        out.push({ text, path: componentPath(node) });
      }
    }
    for (const child of node.children) {
      if (typeof child !== 'string') walk(child);
    }
  };
  walk(tree.root);
  return out;
}
