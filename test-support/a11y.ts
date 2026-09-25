/**
 * Accessibility coverage: every control a finger can use, a screen reader
 * can name (REDESIGN.md 9).
 *
 * The redesign replaces worded buttons with glyphs, so a control that forgets
 * its label is silent to a screen reader and nothing on screen gives it away.
 */
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { componentPath } from './query';

/** Props that make a node something a person operates. */
const HANDLERS = ['onPress', 'onLongPress', 'onValueChange', 'onChangeText'];

/**
 * Handlers that call for a role. A text field is announced as one by the
 * platform, so `onChangeText` alone needs only a label.
 */
const NEEDS_ROLE = ['onPress', 'onLongPress', 'onValueChange'];

export interface A11yProblem {
  /** The composite components above the control, outermost first. */
  path: string;
  /** The handlers that make it a control. */
  handlers: string[];
  missing: 'accessibilityLabel' | 'accessibilityRole';
}

const handlersOf = (node: ReactTestInstance) =>
  HANDLERS.filter(name => typeof node.props[name] === 'function');

/** The first host node a component draws, where its accessibility props land. */
function hostOf(node: ReactTestInstance): ReactTestInstance | undefined {
  if (typeof node.type === 'string') return node;
  for (const child of node.children) {
    if (typeof child === 'string') continue;
    const host = hostOf(child);
    if (host) return host;
  }
  return undefined;
}

const filled = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Controls with no label, or with no role where one applies.
 *
 * A handler is usually passed down through wrappers: a `Button` hands
 * `onPress` to a `Pressable`, which draws a host `View` that holds the label
 * and role but not the handler. So a node whose handler reaches a descendant
 * under the same name is a wrapper and is skipped, and the innermost node
 * still holding a handler is the control. Its first host node, where the
 * accessibility props land, is what gets checked.
 */
export function a11yProblems(tree: ReactTestRenderer): A11yProblem[] {
  const checked = new Set<ReactTestInstance>();
  const out: A11yProblem[] = [];
  for (const node of tree.root.findAll(at => handlersOf(at).length > 0)) {
    const handlers = handlersOf(node);
    const forwarded = handlers.some(
      name =>
        node.findAll(
          inner => inner !== node && typeof inner.props[name] === 'function',
        ).length > 0,
    );
    const host = hostOf(node);
    if (forwarded || !host || checked.has(host)) continue;
    checked.add(host);
    const path = componentPath(host);
    if (!filled(host.props.accessibilityLabel)) {
      out.push({ path, handlers, missing: 'accessibilityLabel' });
    }
    if (
      handlers.some(name => NEEDS_ROLE.includes(name)) &&
      !filled(host.props.accessibilityRole)
    ) {
      out.push({ path, handlers, missing: 'accessibilityRole' });
    }
  }
  return out;
}
