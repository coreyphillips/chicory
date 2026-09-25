/**
 * One track's guard: the states it redraws, each held to REDESIGN.md rule 1
 * (the screen shows data and nothing else) and to rule 9 (a screen reader
 * can name every control).
 *
 * Each track keeps its own list in its own file under __tests__/guards, so no
 * two tracks edit the same one. The CopyGuard and A11yCoverage suites keep
 * the negative controls that prove both checks catch what they should.
 */
import type { ReactElement } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { a11yProblems } from './a11y';
import { copyViolations } from './copyGuard';

export interface GuardedState {
  name: string;
  /** Renders the state and lets it settle; the guard unmounts it. */
  render: () => Promise<ReactTestRenderer>;
  /**
   * What the state shows that is data by content: formatter output such as
   * dates, and fixture values such as wallet names, notes, request strings,
   * txids and recovery words. `guardData` in test-support/fixtures.ts builds
   * it for a state drawn from the shared fixtures.
   */
  data: string[];
}

/** Renders `element` and lets its effects settle, for a state's `render`. */
export async function mount(element: ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

/** Holds every state in `states` to both checks, as `track`'s guard. */
export function guard(track: string, states: GuardedState[]) {
  describe(`the ${track} guard`, () => {
    test('lists each state once', () => {
      const names = states.map(state => state.name);
      expect(new Set(names).size).toBe(names.length);
    });

    for (const state of states) {
      test(`${state.name} shows only data`, async () => {
        const tree = await state.render();
        const found = copyViolations(tree, { data: state.data });
        await act(async () => tree.unmount());
        expect(found).toEqual([]);
      });

      test(`${state.name} names every control`, async () => {
        const tree = await state.render();
        const found = a11yProblems(tree);
        await act(async () => tree.unmount());
        expect(found).toEqual([]);
      });
    }
  });
}
