/**
 * Queries the suites share for reading a rendered tree by what it means.
 *
 * Outside Settings the redesign draws glyphs where the old screens wrote
 * words, and moves those words into accessibility props. So a suite finds a
 * control by its label, reads state from accessibility props, and checks what
 * a person perceives through `meaning`: the text on screen plus the text a
 * screen reader speaks.
 */
import { act } from 'react-test-renderer';
import type {
  ReactTestInstance,
  ReactTestRenderer,
  ReactTestRendererJSON,
} from 'react-test-renderer';

type Props = ReactTestRendererJSON['props'];

/**
 * A component's name for paths and lookups: its displayName, else its
 * function name, seen through `memo` and `forwardRef` wrappers. Host nodes are
 * named by their type.
 */
export function componentName(type: ReactTestInstance['type']): string {
  if (typeof type === 'string') return type;
  const wrapped = type as {
    displayName?: string;
    name?: string;
    render?: { displayName?: string; name?: string };
    type?: ReactTestInstance['type'];
  };
  return (
    wrapped.displayName ||
    wrapped.name ||
    wrapped.render?.displayName ||
    wrapped.render?.name ||
    (wrapped.type ? componentName(wrapped.type) : '')
  );
}

/**
 * The composite components above `node`, outermost first, joined with ` > `.
 * Anonymous components are left out, and a name repeated by a wrapper, such
 * as `memo` around a component of the same name, appears once.
 */
export function componentPath(node: ReactTestInstance): string {
  const names: string[] = [];
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (typeof at.type === 'string') continue;
    const name = componentName(at.type);
    if (name && name !== names[0]) names.unshift(name);
  }
  return names.join(' > ');
}

/**
 * The strings a node draws itself. Adjacent string children render as one
 * run of text, so `{amount} sats` reads as "4,200 sats"; a nested element
 * ends the run. Whitespace-only runs are dropped.
 */
export function ownText(children: ReadonlyArray<unknown> | null): string[] {
  const runs: string[] = [];
  let run = '';
  for (const child of children ?? []) {
    if (typeof child === 'string') {
      run += child;
      continue;
    }
    runs.push(run);
    run = '';
  }
  runs.push(run);
  return runs.map(text => text.trim()).filter(Boolean);
}

function hosts(tree: ReactTestRenderer): ReactTestRendererJSON[] {
  const out: ReactTestRendererJSON[] = [];
  const walk = (node: ReactTestRendererJSON) => {
    out.push(node);
    for (const child of node.children ?? []) {
      if (typeof child !== 'string') walk(child);
    }
  };
  const root = tree.toJSON();
  for (const node of Array.isArray(root) ? root : root ? [root] : []) {
    walk(node);
  }
  return out;
}

const strings = (props: Props, names: string[]) =>
  names
    .map(name => props[name])
    .filter(
      (value): value is string =>
        typeof value === 'string' && value.trim() !== '',
    );

/**
 * The pressable control labelled `label`, or undefined. A control in a pane
 * that is not active exposes no `onPress`, so it is not found here even
 * while it is still mounted.
 */
export function find(
  tree: ReactTestRenderer,
  label: string,
): ReactTestInstance | undefined {
  return tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0];
}

/**
 * Presses the control labelled `label` and waits for whatever it started.
 * Throws, naming what can be pressed instead, when there is no such control.
 */
export async function press(
  tree: ReactTestRenderer,
  label: string,
): Promise<void> {
  const target = find(tree, label);
  if (!target) {
    const live = [...pressableLabels(tree)].map(name => `"${name}"`);
    throw new Error(
      `No pressable control labelled "${label}". Pressable: ${
        live.join(', ') || 'none'
      }.`,
    );
  }
  await act(async () => {
    await target.props.onPress();
  });
}

/**
 * The text field labelled `label`. Throws, naming the fields there are, when
 * there is none.
 */
export function field(
  tree: ReactTestRenderer,
  label: string,
): ReactTestInstance {
  const fields = tree.root.findAll(
    node => typeof node.props.onChangeText === 'function',
  );
  const target = fields.find(node => node.props.accessibilityLabel === label);
  if (!target) {
    const names = new Set(
      fields
        .map(node => node.props.accessibilityLabel)
        .filter(name => typeof name === 'string')
        .map(name => `"${name}"`),
    );
    throw new Error(
      `No field labelled "${label}". Fields: ${
        [...names].join(', ') || 'none'
      }.`,
    );
  }
  return target;
}

/**
 * Every string on screen: the text children of every host node, plus the
 * placeholder, title and default value props, in tree order.
 */
export function visibleText(tree: ReactTestRenderer): string[] {
  return hosts(tree).flatMap(node => [
    ...ownText(node.children),
    ...strings(node.props, ['placeholder', 'title', 'defaultValue']),
  ]);
}

/**
 * Every string a screen reader is given: the label, hint and value text of
 * every host node, in tree order.
 */
export function a11yText(tree: ReactTestRenderer): string[] {
  return hosts(tree).flatMap(node => [
    ...strings(node.props, ['accessibilityLabel', 'accessibilityHint']),
    ...strings(node.props.accessibilityValue ?? {}, ['text']),
  ]);
}

/**
 * What the tree says by any channel, seen or spoken, joined with ` | `, for
 * `toContain` checks that should not care which channel carries a phrase.
 */
export function meaning(tree: ReactTestRenderer): string {
  return [...visibleText(tree), ...a11yText(tree)].join(' | ');
}

/**
 * What each alert says, in tree order: its label when it has one, since that
 * is what a screen reader reads, else the text inside it.
 */
export function alerts(tree: ReactTestRenderer): string[] {
  return hosts(tree)
    .filter(node => node.props.accessibilityRole === 'alert')
    .map(node => {
      const [label] = strings(node.props, ['accessibilityLabel']);
      if (label) return label;
      const inside: string[] = [];
      const walk = (at: ReactTestRendererJSON) => {
        inside.push(...ownText(at.children));
        for (const child of at.children ?? []) {
          if (typeof child !== 'string') walk(child);
        }
      };
      walk(node);
      return inside.join(' ');
    });
}

/**
 * The labels of every control that can be pressed right now, meaning it
 * holds an `onPress` function. A disabled control still counts; read its
 * `accessibilityState` to tell.
 */
export function pressableLabels(tree: ReactTestRenderer): Set<string> {
  return new Set(
    tree.root
      .findAll(
        node =>
          typeof node.props.onPress === 'function' &&
          typeof node.props.accessibilityLabel === 'string' &&
          node.props.accessibilityLabel !== '',
      )
      .map(node => node.props.accessibilityLabel as string),
  );
}
