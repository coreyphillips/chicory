import { createWorkletRuntime, runOnRuntimeAsync } from 'react-native-worklets';
import { calculateSpliceOutQuote } from '@beignet/portable-engine/splice-out-quote';
import type { SpliceOutQuoteSnapshot } from '@beignet/portable-engine/splice-out-quote';

// Share a compute queue across reviews. Each job receives only the public
// inputs for its quote and has no connection to the live wallet.
let runtime: ReturnType<typeof createWorkletRuntime> | undefined;

export function runSpliceOutQuote(snapshot: SpliceOutQuoteSnapshot) {
  runtime ??= createWorkletRuntime({
    name: 'Splice quotes',
    enableEventLoop: false,
    enableNetworking: false,
  });
  return runOnRuntimeAsync(runtime, calculateSpliceOutQuote, snapshot);
}
