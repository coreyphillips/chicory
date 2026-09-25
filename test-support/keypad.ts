/**
 * Amount entry that works on either side of the keypad change.
 *
 * The redesign replaces the system keyboard with its own keypad for amounts
 * (REDESIGN.md, Keypad). Suites enter and read amounts through these two
 * helpers, so the same test drives the old text field and the new keypad.
 */
import { act } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { copy } from '../src/design/copy';
import { field, press } from './query';

/** An amount of sats never needs more digits than the supply's 16. */
const MOST_DIGITS = 16;

/**
 * The digits of the amount labelled `label`, read from its `value` prop or,
 * on a keypad's display, from its `accessibilityValue.text`. Separators and
 * units are dropped, so "4,200 sats" reads as "4200".
 */
export function amountValue(
  tree: ReactTestRenderer,
  label = copy.amount.field,
): string {
  for (const node of tree.root.findAllByProps({ accessibilityLabel: label })) {
    const shown =
      typeof node.props.value === 'string'
        ? node.props.value
        : node.props.accessibilityValue?.text;
    if (typeof shown === 'string') return shown.replace(/[^0-9]/g, '');
  }
  throw new Error(`No amount labelled "${label}".`);
}

/**
 * Enters `digits` as the amount labelled `label`, replacing what was there.
 *
 * On the keypad this presses backspace until the amount is empty, then each
 * digit key in turn, the way a person would. Without a keypad it types into
 * the text field. An amount showing only zeros counts as empty, since a
 * display may draw an empty amount as 0.
 */
export async function enterAmount(
  tree: ReactTestRenderer,
  digits: string,
  label = copy.amount.field,
): Promise<void> {
  if (
    !tree.root.findAllByProps({ accessibilityLabel: copy.keypad.label }).length
  ) {
    await act(async () => {
      field(tree, label).props.onChangeText(digits);
    });
    return;
  }
  for (let presses = 0; !/^0*$/.test(amountValue(tree, label)); presses++) {
    if (presses === MOST_DIGITS) {
      throw new Error(
        `The amount did not clear after ${MOST_DIGITS} presses of "${copy.keypad.backspace}".`,
      );
    }
    await press(tree, copy.keypad.backspace);
  }
  for (const key of digits) {
    await press(tree, copy.keypad.digits[Number(key)]);
  }
}
