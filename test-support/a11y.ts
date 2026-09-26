/**
 * Accessibility coverage: every control a finger can use, a screen reader
 * can name (REDESIGN.md 9).
 *
 * The redesign replaces worded buttons with glyphs, so a control that forgets
 * its label is silent to a screen reader and nothing on screen gives it away.
 */
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import { componentName, componentPath } from './query';

declare const require: (id: string) => any;

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
 * Whether `host` is the view a `Pressable` draws. Between the two sit only
 * React Native's `View` wrapper and anonymous ones.
 */
function drawnByPressable(host: ReactTestInstance): boolean {
  for (let at = host.parent; at; at = at.parent) {
    if (typeof at.type === 'string') return false;
    const name = componentName(at.type);
    if (name === 'Pressable') return true;
    if (name && name !== 'View') return false;
  }
  return false;
}

/**
 * Controls with no label, or with no role where one applies.
 *
 * A handler is usually passed down through wrappers: a `Button` hands
 * `onPress` to a `Pressable`, which draws a host `View` that holds the label
 * and role but not the handler. So a node whose handler reaches a descendant
 * under the same name is a wrapper and is skipped, and the innermost node
 * still holding a handler is the control. Its first host node, where the
 * accessibility props land, is what gets checked.
 *
 * A `Pressable` a screen reader reaches needs its role even while it takes
 * no touch, as in a pane out of use: a role that comes and goes with the
 * handler is one iOS keeps after it goes (see `vanishingRoles`).
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
  const pressables = tree.root.findAll(
    at =>
      typeof at.type === 'string' &&
      at.props.accessible !== false &&
      !checked.has(at) &&
      drawnByPressable(at),
  );
  for (const host of pressables) {
    if (filled(host.props.accessibilityRole)) continue;
    out.push({
      path: componentPath(host),
      handlers: handlersOf(host),
      missing: 'accessibilityRole',
    });
  }
  return out;
}

/** The props a role reaches a native view by. */
const ROLE_ATTRIBUTES = new Set(['accessibilityRole', 'role']);

/**
 * Whether a role expression can leave the role out: `undefined`, `null`, a
 * `cond && role` that gives `false`, or a branch that does any of these.
 */
function mayVanish(expression: any): boolean {
  switch (expression?.type) {
    case 'Identifier':
      return expression.name === 'undefined';
    case 'NullLiteral':
      return true;
    case 'ConditionalExpression':
      return (
        mayVanish(expression.consequent) || mayVanish(expression.alternate)
      );
    case 'LogicalExpression':
      return expression.operator === '&&' || mayVanish(expression.right);
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return mayVanish(expression.expression);
    default:
      return false;
  }
}

/** Calls `visit` on `node` and every node under it. */
function walk(node: any, visit: (node: any) => void) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

/**
 * The roles in one file that can be taken away while their element stays
 * drawn, as `line: text`.
 *
 * React sends a removed prop as null so native code resets it, but React
 * Native's iOS props (AccessibilityProps.cpp) read a null role as "keep the
 * one before". So an element whose role goes from `button` to `undefined`
 * stays a button to VoiceOver. A role that comes and goes is written with
 * `'none'` for its absence instead.
 */
export function vanishingRoles(source: string): string[] {
  const parser = require('@babel/parser');
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const lines = source.split('\n');
  const hits: string[] = [];
  const hit = (node: any) =>
    hits.push(
      `${node.loc.start.line}: ${lines[node.loc.start.line - 1].trim()}`,
    );
  walk(ast.program, node => {
    if (
      node.type === 'JSXAttribute' &&
      ROLE_ATTRIBUTES.has(node.name?.name) &&
      node.value?.type === 'JSXExpressionContainer' &&
      mayVanish(node.value.expression)
    ) {
      hit(node);
    }
    if (
      node.type === 'ObjectProperty' &&
      (node.key?.name ?? node.key?.value) === 'accessibilityRole' &&
      mayVanish(node.value)
    ) {
      hit(node);
    }
  });
  return hits;
}
