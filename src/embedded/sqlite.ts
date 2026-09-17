import { Buffer } from 'buffer';
import type { Scalar, QueryResult } from '@op-engineering/op-sqlite';

export interface SynchronousDatabase {
  executeSync(sql: string, params?: Scalar[]): QueryResult;
  close(): void;
}
type Row = Record<string, Scalar>;

function parameters(values: unknown[]): Scalar[] {
  const flat =
    values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return flat.map(value => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      value instanceof ArrayBuffer ||
      ArrayBuffer.isView(value)
    ) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    throw new TypeError('Unsupported SQLite parameter.');
  });
}

/** Synchronous better-sqlite3 surface used by the unchanged channel storage. */
export class NativeSqliteDatabase {
  private depth = 0;
  private sequence = 0;
  private closed = false;
  private poisoned = false;

  constructor(private readonly native: SynchronousDatabase) {
    this.native.executeSync('PRAGMA journal_mode = WAL');
    this.native.executeSync('PRAGMA synchronous = FULL');
    this.native.executeSync('PRAGMA fullfsync = ON');
    this.native.executeSync('PRAGMA checkpoint_fullfsync = ON');
    this.native.executeSync('PRAGMA foreign_keys = ON');
    this.native.executeSync('PRAGMA busy_timeout = 5000');
    const mode = this.native.executeSync('PRAGMA synchronous').rows[0];
    if (!mode || Number(Object.values(mode)[0]) !== 2) {
      this.native.close();
      throw new Error(
        'Durable SQLite FULL synchronization could not be enabled.',
      );
    }
  }

  private query(sql: string, values: unknown[] = []): QueryResult {
    if (this.closed || this.poisoned) {
      throw new Error('The durable wallet database is closed.');
    }
    let result: QueryResult;
    try {
      result = this.native.executeSync(sql, parameters(values));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /SQLITE_(?:IOERR|FULL|CORRUPT|NOTADB)|disk (?:I\/O|full)|database (?:disk image is malformed|or disk is full)/i.test(
          message,
        )
      )
        this.poisoned = true;
      throw error;
    }
    for (const row of result.rows) {
      for (const [key, value] of Object.entries(row)) {
        if (value instanceof ArrayBuffer) {
          row[key] = Buffer.from(value);
        } else if (ArrayBuffer.isView(value)) {
          row[key] = Buffer.from(
            new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
          );
        }
        if (
          typeof value === 'number' &&
          Number.isInteger(value) &&
          !Number.isSafeInteger(value)
        ) {
          throw new Error('SQLite returned an integer outside the safe range.');
        }
      }
    }
    return result;
  }

  prepare(sql: string) {
    return {
      run: (...values: unknown[]) => {
        const result = this.query(sql, values);
        return {
          changes: result.rowsAffected,
          lastInsertRowid: result.insertId ?? 0,
        };
      },
      get: (...values: unknown[]): Row | undefined =>
        this.query(sql, values).rows[0],
      all: (...values: unknown[]): Row[] => this.query(sql, values).rows,
      iterate: (...values: unknown[]) =>
        this.query(sql, values).rows[Symbol.iterator](),
    };
  }

  exec(sql: string) {
    this.query(sql);
    return this;
  }

  pragma(sql: string, options?: { simple?: boolean }) {
    // A mobile engine must never downgrade the disk barrier for performance.
    if (
      /^\s*synchronous\s*=/i.test(sql) &&
      !/^\s*synchronous\s*=\s*(?:FULL|2)\s*;?\s*$/i.test(sql)
    ) {
      throw new Error('The mobile wallet requires SQLite synchronous=FULL.');
    }
    const rows = this.query(`PRAGMA ${sql}`).rows;
    return options?.simple
      ? rows[0]
        ? Object.values(rows[0])[0]
        : undefined
      : rows;
  }

  transaction<F extends (...args: any[]) => any>(fn: F): F {
    const wrapped = (...args: Parameters<F>): ReturnType<F> => {
      const outer = this.depth === 0;
      const savepoint = `beignet_${++this.sequence}`;
      this.query(outer ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      this.depth++;
      let committing = false;
      try {
        const result = fn(...args);
        if (
          result &&
          typeof (result as { then?: unknown }).then === 'function'
        ) {
          throw new Error(
            'A durable wallet transaction cannot be asynchronous.',
          );
        }
        committing = true;
        this.query(outer ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        try {
          this.query(outer ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}`);
          if (!outer) {
            this.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
        } catch {
          this.poisoned = true;
        }
        // Even a successful rollback cannot undo advanced in-memory channel
        // state after a failed commit barrier. Stop all use until restart.
        if (committing) this.poisoned = true;
        throw error;
      } finally {
        this.depth--;
      }
    };
    return wrapped as F;
  }

  backup(): never {
    throw new Error(
      'Physical SQLite export is not available through the mobile driver. A phrase alone does not back up current channel state.',
    );
  }

  close() {
    if (this.closed) {
      return;
    }
    if (this.depth) {
      throw new Error('Cannot close an active wallet transaction.');
    }
    this.native.close();
    this.closed = true;
  }
}
