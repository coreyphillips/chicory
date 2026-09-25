/**
 * The gallery's hands. A state past the first step of a flow, such as a
 * review or a result, is reached the way a person reaches it: by pressing
 * the control labelled for it, with the fake wallet answering at once.
 *
 * There is no test renderer on a phone, so a control is found in React's
 * own tree instead: from the Probe at the root of the state, down through
 * each component's committed props, for the first one with the label and
 * the handler asked for, as test-support/query.ts finds one in a suite. A
 * control in a pane out of use has no handler, so it is not found.
 *
 * Every line the gallery writes starts with GALLERY, so a device log can be
 * filtered down to it. A step that finds nothing to press says MISS, and a
 * state that throws says ERROR, each with the state's name.
 */
import { Component } from 'react';
import type { PropsWithChildren, RefObject } from 'react';

export function report(line: string) {
  console.log(`GALLERY ${line}`);
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * The root of one state. It catches what the state throws while drawing, so
 * one broken state is reported and the rest still run, and it is where a
 * step starts looking for the control it asks for.
 */
export class Probe extends Component<
  PropsWithChildren<{ name: string }>,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    report(`ERROR ${this.props.name}: ${reason(error)}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The parts of a React fiber the search reads. */
interface Fiber {
  child: Fiber | null;
  sibling: Fiber | null;
  return: Fiber | null;
  type: unknown;
  stateNode: unknown;
  memoizedProps: unknown;
}

type Props = Record<string, unknown>;
type Handler = (...args: unknown[]) => unknown;

/** A finger's long press on a hold, as the gesture handler reports it. */
export type HoldStep = 'down' | 'complete' | 'up';

const HOLD_CALLBACKS: Record<HoldStep, string> = {
  down: 'onBegin',
  complete: 'onActivate',
  up: 'onFinalize',
};

/** The first fiber from `start`, its siblings and all below, in tree order. */
function first(start: Fiber | null, test: (fiber: Fiber) => boolean) {
  const stack = start ? [start] : [];
  while (stack.length) {
    const fiber = stack.pop() as Fiber;
    if (test(fiber)) return fiber;
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return null;
}

/**
 * The probe as it stands now. A class instance keeps a fiber, but not
 * always the committed one, so the search climbs to the root and comes back
 * down the committed tree to the fiber that holds this instance.
 */
function committed(instance: Probe): Fiber | null {
  let top =
    (instance as unknown as { _reactInternals?: Fiber })._reactInternals ??
    null;
  while (top?.return) top = top.return;
  const root = (top?.stateNode as { current?: Fiber } | null)?.current;
  return root ? first(root, fiber => fiber.stateNode === instance) : null;
}

const propsOf = (fiber: Fiber): Props | null =>
  fiber.memoizedProps !== null && typeof fiber.memoizedProps === 'object'
    ? (fiber.memoizedProps as Props)
    : null;

/** Where a whisper is asked for, as a finger on the middle of the screen. */
const ANCHOR = { x: 160, y: 320, width: 24, height: 24 };

/** What a screen reader sends when it activates an element. */
const ACTIVATE = { nativeEvent: { actionName: 'activate' } };

export interface Drive {
  /** Taps the control labelled `label`. */
  press: (label: string) => void;
  /** Commits the hold labelled `label`, as a screen reader does. */
  activate: (label: string) => void;
  /** Types `text` into the field labelled `label`. */
  type: (label: string, text: string) => void;
  /** Calls `handler` of the control labelled `label` with `args`. */
  fire: (label: string, handler: string, ...args: unknown[]) => void;
  /**
   * Moves the hold labelled `label` through `step` of a finger's long press:
   * down on it, held until it completes, or lifted.
   */
  hold: (label: string, step: HoldStep) => void;
  /** Calls the first `handler` anywhere in the state with `args`. */
  call: (handler: string, ...args: unknown[]) => void;
  /** Shows the whisper labelled `label`, as a long press does. */
  whisper: (label: string) => void;
}

/** Hands for the state named `name`, drawn under `probe`. */
export function driver(probe: RefObject<Probe | null>, name: string): Drive {
  function find(test: (props: Props, fiber: Fiber) => boolean): Props | null {
    const instance = probe.current;
    const root = instance ? committed(instance) : null;
    const found = first(root?.child ?? null, fiber => {
      const props = propsOf(fiber);
      return !!props && test(props, fiber);
    });
    return found ? propsOf(found) : null;
  }

  function invoke(what: string, handler: Handler | null, args: unknown[]) {
    if (!handler) {
      report(`MISS ${name}: ${what}`);
      return;
    }
    try {
      const result = handler(...args) as PromiseLike<unknown> | undefined;
      if (typeof result?.then === 'function') {
        result.then(undefined, error =>
          report(`ERROR ${name}: ${reason(error)}`),
        );
      }
    } catch (error) {
      report(`ERROR ${name}: ${reason(error)}`);
    }
  }

  /** The first `handler` held by a component that passes `test`. */
  function handlerOf(
    handler: string,
    test: (props: Props, fiber: Fiber) => boolean,
  ): Handler | null {
    const props = find(
      (candidate, fiber) =>
        typeof candidate[handler] === 'function' && test(candidate, fiber),
    );
    return props ? (props[handler] as Handler) : null;
  }

  const fire = (label: string, handler: string, ...args: unknown[]) =>
    invoke(
      `${handler} "${label}"`,
      handlerOf(handler, props => props.accessibilityLabel === label),
      args,
    );

  /**
   * A hold is a long press the gesture handler times, with no handler on
   * the control itself, so the step goes to the innermost long press around
   * the control labelled `label`, as the handler would report it.
   */
  function holdOf(label: string, step: HoldStep): Handler | null {
    const instance = probe.current;
    const root = instance ? committed(instance) : null;
    const labelled = (fiber: Fiber) =>
      !!first(
        fiber.child,
        inner => propsOf(inner)?.accessibilityLabel === label,
      );
    let innermost: Handler | null = null;
    first(root?.child ?? null, fiber => {
      const config = (propsOf(fiber)?.gesture as { config?: Props } | undefined)
        ?.config;
      const callback = config?.[HOLD_CALLBACKS[step]];
      if (
        typeof config?.minDurationMs === 'number' &&
        typeof callback === 'function' &&
        labelled(fiber)
      ) {
        innermost = callback as Handler;
      }
      return false;
    });
    return innermost;
  }

  return {
    press: label => fire(label, 'onPress'),
    activate: label =>
      invoke(
        `activate "${label}"`,
        handlerOf(
          'onAccessibilityAction',
          (props, fiber) =>
            typeof fiber.type === 'string' &&
            props.accessibilityLabel === label,
        ),
        [ACTIVATE],
      ),
    type: (label, text) => fire(label, 'onChangeText', text),
    fire,
    hold: (label, step) =>
      invoke(`hold ${step} "${label}"`, holdOf(label, step), [
        step === 'up' ? { canceled: false } : {},
      ]),
    call: (handler, ...args) =>
      invoke(
        handler,
        handlerOf(handler, () => true),
        args,
      ),
    whisper: label => {
      // A whisper is a long press the gallery has no finger for, so it asks
      // the whisper's provider directly, as the press would.
      const showOf = (props: Props | null) =>
        (props?.whispers as { show?: Handler } | undefined)?.show ?? null;
      const heard = find(
        props => props.label === label && typeof showOf(props) === 'function',
      );
      invoke(`whisper "${label}"`, showOf(heard), [label, ANCHOR, {}]);
    },
  };
}
