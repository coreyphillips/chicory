/**
 * Where the app is, read from the stage rather than from the screen.
 *
 * Animation never gates meaning (REDESIGN.md 2.4): the phase and the scene
 * change synchronously and the panes follow. So a suite asks the stage what it
 * is showing instead of waiting for a pane to arrive.
 *
 * The contract these readers set: the `Stage` and `Canvas` components, found
 * by their displayName, take the shell phase as a `phase` prop (a `Phase`)
 * and the navigation state as a `stage` prop (a `StageState`). Until those
 * components exist, both readers return null.
 */
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';
import type { Phase } from '../src/stage/phase';
import type { Scene, StageState } from '../src/stage/scene';
import { componentName } from './query';

const STAGED = ['Stage', 'Canvas'];

function staged(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll(
    node =>
      typeof node.type !== 'string' &&
      STAGED.includes(componentName(node.type)),
  );
}

/** The kind of the phase the stage is in, or null before there is a stage. */
export function activePhase(tree: ReactTestRenderer): Phase['kind'] | null {
  for (const node of staged(tree)) {
    const phase = node.props.phase as Phase | undefined;
    if (phase) return phase.kind;
  }
  return null;
}

/**
 * The name of the scene the canvas shows, or null before there is a canvas.
 * An overlay such as Scan covers the scene without replacing it, so it does
 * not change the answer.
 */
export function activeScene(tree: ReactTestRenderer): Scene['name'] | null {
  for (const node of staged(tree)) {
    const stage = node.props.stage as StageState | undefined;
    if (stage) return stage.scene.name;
  }
  return null;
}
