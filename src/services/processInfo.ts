import { NativeModules } from 'react-native';

interface NativeProcess {
  threadCount(): Promise<number>;
}

/**
 * How many threads this process has, as the kernel counts them: Android reads
 * `/proc/self/task` and iOS asks Mach. The Diagnostics report carries it so a
 * leak of parked threads can be read off a copied report before the system
 * kills the app for it. Null where no build carries the module, as under Jest,
 * or where it could not answer; the report then leaves the figure out.
 */
export async function threadCount(): Promise<number | null> {
  const native: NativeProcess | undefined = NativeModules.ChicoryProcess;
  if (!native) return null;
  try {
    const count = await native.threadCount();
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}
