import type { EmbeddedRuntimeRequest } from '@beignet/wallet-core';
import type { PaymentNote } from '../services/paymentNotes';
import type { DeviceSettings } from './deviceSettings';
import type { SqliteTally } from '../services/perf';

export type Diagnostic = { phase: string; message: string; stack?: string };
export type HostEvent =
  | { type: 'diagnostic'; event: Diagnostic }
  | { type: 'log'; event: Diagnostic }
  | { type: 'boot'; name: string; at: number; detail?: string }
  | { type: 'sqlite'; tally: SqliteTally };
export type OpenOptions = { existingOnly?: boolean; allowEmpty?: boolean };
export type HostRequest =
  | { op: 'preferences' | 'erase' }
  | {
      op: 'open';
      session: string;
      settings: DeviceSettings;
      options?: OpenOptions;
      perfUntil: number;
    }
  | { op: 'close'; session: string }
  | { op: 'request'; session: string; request: EmbeddedRuntimeRequest }
  | { op: 'background'; session: string; background: boolean }
  | { op: 'readNotes'; session: string; scope: string }
  | {
      op: 'saveNote';
      session: string;
      scope: string;
      key: string;
      note: PaymentNote;
    }
  | {
      op: 'moveNotes';
      session: string;
      scope: string;
      moves: [string, string][];
    };

export function failure(error: unknown): string {
  const cause = error as {
    message?: string;
    code?: string;
    status?: number;
  } | null;
  return JSON.stringify({
    error: {
      message:
        cause?.message || 'The device wallet could not complete the request.',
      code: typeof cause?.code === 'string' ? cause.code : undefined,
      status: typeof cause?.status === 'number' ? cause.status : undefined,
    },
  });
}
