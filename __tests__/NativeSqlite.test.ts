import {
  NativeSqliteDatabase,
  SynchronousDatabase,
} from '../src/embedded/sqlite';
import type { Scalar } from '@op-engineering/op-sqlite';

const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, Scalar>[];
    };
    close(): void;
  };
};
const { rmSync } = require('node:fs') as {
  rmSync(path: string, options: { force: boolean }): void;
};

function nativeDatabase(path: string, log: string[] = []): SynchronousDatabase {
  const db = new DatabaseSync(path);
  return {
    executeSync(sql, params = []) {
      log.push(sql);
      const rows = db.prepare(sql).all(...params);
      const counters = db
        .prepare('SELECT changes() AS changes, last_insert_rowid() AS id')
        .all()[0];
      return {
        rows,
        rowsAffected: Number(counters.changes),
        insertId: Number(counters.id),
      };
    },
    close() {
      db.close();
    },
  };
}

test('commits durable state before returning to a caller that can send wire messages', () => {
  const path = `/tmp/beignet-native-barrier-${Date.now()}.sqlite`;
  const operations: string[] = [];
  let database = new NativeSqliteDatabase(nativeDatabase(path, operations));
  try {
    database.exec(
      'CREATE TABLE channels (id TEXT PRIMARY KEY, state TEXT NOT NULL)',
    );
    database.transaction(() =>
      database
        .prepare('INSERT INTO channels VALUES (?, ?)')
        .run('channel-1', 'signed-next-state'),
    )();
    operations.push('SEND_COMMITMENT_SIGNATURE');
    expect(operations.indexOf('COMMIT')).toBeLessThan(
      operations.indexOf('SEND_COMMITMENT_SIGNATURE'),
    );
    database.close();
    database = new NativeSqliteDatabase(nativeDatabase(path));
    expect(
      database
        .prepare('SELECT state FROM channels WHERE id = ?')
        .get('channel-1')?.state,
    ).toBe('signed-next-state');
  } finally {
    database.close();
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(path + suffix, { force: true });
    }
  }
});

test('failed and async transactions roll back; nested failures preserve the outer atomic operation', () => {
  const database = new NativeSqliteDatabase(nativeDatabase(':memory:'));
  try {
    database.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT)');
    expect(() =>
      database.transaction(() => {
        database.prepare('INSERT INTO entries VALUES (?, ?)').run(1, 'discard');
        throw new Error('disk or signing failure');
      })(),
    ).toThrow('disk or signing failure');
    expect(database.prepare('SELECT * FROM entries').all()).toEqual([]);
    expect(() =>
      database.transaction(() => Promise.resolve('unsafe'))(),
    ).toThrow('cannot be asynchronous');
    database.transaction(() => {
      database.prepare('INSERT INTO entries VALUES (?, ?)').run(2, 'keep');
      try {
        database.transaction(() => {
          database
            .prepare('INSERT INTO entries VALUES (?, ?)')
            .run(3, 'discard');
          throw new Error('inner failure');
        })();
      } catch {}
    })();
    expect(database.prepare('SELECT id FROM entries').all()).toEqual([
      { id: 2 },
    ]);
    expect(() => database.pragma('synchronous = NORMAL')).toThrow(
      'requires SQLite synchronous=FULL',
    );
  } finally {
    database.close();
  }
});

test('encrypted recovery BLOB rows retain the Buffer contract on all read paths', () => {
  const { Buffer } = require('buffer') as typeof import('buffer');
  const database = new NativeSqliteDatabase(nativeDatabase(':memory:'));
  try {
    database.exec('CREATE TABLE recovery (ciphertext BLOB)');
    database
      .prepare('INSERT INTO recovery VALUES (?)')
      .run(new Uint8Array([17, 33, 255]));
    const statement = database.prepare('SELECT ciphertext FROM recovery');
    for (const row of [
      statement.get()!,
      ...statement.all(),
      ...statement.iterate(),
    ]) {
      expect(Buffer.isBuffer(row.ciphertext)).toBe(true);
      expect(Array.from(row.ciphertext as Uint8Array)).toEqual([17, 33, 255]);
    }
  } finally {
    database.close();
  }
});

test('a failed COMMIT poisons the connection even when rollback succeeds', () => {
  const native = nativeDatabase(':memory:');
  const driver: SynchronousDatabase = {
    executeSync(sql, params) {
      if (sql === 'COMMIT') throw new Error('commit barrier failed');
      return native.executeSync(sql, params);
    },
    close: () => native.close(),
  };
  const database = new NativeSqliteDatabase(driver);
  try {
    database.exec('CREATE TABLE channels (state TEXT)');
    expect(() =>
      database.transaction(() =>
        database.prepare('INSERT INTO channels VALUES (?)').run('unsafe'),
      )(),
    ).toThrow('commit barrier failed');
    expect(() =>
      database.prepare('INSERT INTO channels VALUES (?)').run('later'),
    ).toThrow('database is closed');
    expect(native.executeSync('SELECT * FROM channels').rows).toEqual([]);
  } finally {
    database.close();
  }
});

test('a low-level disk error poisons the connection and prevents later wire-state updates', () => {
  const native = nativeDatabase(':memory:');
  let fail = false;
  const database = new NativeSqliteDatabase({
    executeSync(sql, params) {
      if (fail) throw new Error('SQLITE_FULL: database or disk is full');
      return native.executeSync(sql, params);
    },
    close: () => native.close(),
  });
  try {
    database.exec('CREATE TABLE channels (state TEXT)');
    fail = true;
    expect(() =>
      database.prepare('INSERT INTO channels VALUES (?)').run('unsafe'),
    ).toThrow('SQLITE_FULL');
    fail = false;
    expect(() =>
      database.prepare('INSERT INTO channels VALUES (?)').run('later'),
    ).toThrow('database is closed');
  } finally {
    database.close();
  }
});
