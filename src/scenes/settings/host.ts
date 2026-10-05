import { createContext, useContext } from 'react';
import type { ScanRequest } from '../../stage/useScanReceiver';

/**
 * What the Settings scene does for the page it holds, which the page cannot
 * do from inside its scroll view: answer Android back through the stage,
 * and ask the stage's scan overlay for a code on behalf of a field.
 *
 * Outside the scene, as when a suite renders `SettingsScreen` alone, back is
 * never asked, so it does nothing, and there is no overlay to ask: a field
 * draws the scanner in its own place instead (`useFieldScan`).
 */
export interface SettingsHost {
  /**
   * A hook: answers Android back while `active` (REDESIGN.md 2.2), the way
   * `useSceneBack` does. The scene passes `useSceneBack` itself.
   */
  useBack: (handler: () => boolean, active: boolean) => void;
  /** Opens the scan overlay for a field (`useScanRequest`). */
  scan?: (request: ScanRequest) => void;
}

const nothing: SettingsHost = { useBack: () => {} };

export const SettingsHostContext = createContext<SettingsHost>(nothing);

export const useSettingsHost = () => useContext(SettingsHostContext);
