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

/**
 * The network map's rows (gossip) are the one thing the engine may write in
 * batches: its storage coalesces them into one transaction when the database
 * sets `portableGossipBatch`, so the primary's gossip is not one synced
 * commit per message on the JS thread. Channel state is never batched.
 */
describe('gossip batching', () => {
  const GOSSIP_TABLE =
    'CREATE TABLE gossip_channels (scid_hex TEXT PRIMARY KEY, channel_json TEXT NOT NULL)';
  const SAVE_CHANNEL =
    'INSERT OR REPLACE INTO gossip_channels (scid_hex, channel_json) VALUES (?, ?)';

  test('the phone database asks the engine to batch the network map', () => {
    const database = new NativeSqliteDatabase(nativeDatabase(':memory:'));
    try {
      expect(database.portableGossipBatch).toBe(true);
    } finally {
      database.close();
    }
  });

  test('the installed engine still batches on that flag, through the database transaction', () => {
    // A fork that renamed the flag would quietly go back to a commit per
    // message, so the bundle the app ships is read as it is.
    const { fs, path, ROOT } =
      require('../test-support/node') as typeof import('../test-support/node');
    const bundle = fs.readFileSync(
      path.join(
        ROOT,
        'node_modules/@beignet/portable-engine/dist/portable.cjs',
      ),
      'utf8',
    );
    expect(bundle).toContain('if (this.db.portableGossipBatch)');
    expect(bundle).toMatch(
      /new ReconstructableBatch\(\s*\(fn\) => this\.db\.transaction\(fn\)\(\)/,
    );
  });

  test('a full batch of 500 rows is one transaction and one commit, and is there after a reopen', () => {
    const path = `/tmp/beignet-native-gossip-${Date.now()}.sqlite`;
    const operations: string[] = [];
    let database = new NativeSqliteDatabase(nativeDatabase(path, operations));
    try {
      database.exec(GOSSIP_TABLE);
      operations.length = 0;
      // What the engine's batch queues, and how it flushes them: every
      // queued write inside one call to the database's transaction.
      const queued = Array.from(
        { length: 500 },
        (_, index) => () =>
          database
            .prepare(SAVE_CHANNEL)
            .run(index.toString(16).padStart(16, '0'), `{"n":${index}}`),
      );
      database.transaction(() => {
        for (const write of queued) write();
      })();
      expect(operations.filter(sql => sql === 'BEGIN IMMEDIATE')).toHaveLength(
        1,
      );
      expect(operations.filter(sql => sql === 'COMMIT')).toHaveLength(1);
      expect(operations).toHaveLength(502);
      database.close();
      database = new NativeSqliteDatabase(nativeDatabase(path));
      expect(
        database.prepare('SELECT count(*) AS count FROM gossip_channels').get()
          ?.count,
      ).toBe(500);
    } finally {
      database.close();
      for (const suffix of ['', '-wal', '-shm']) {
        rmSync(path + suffix, { force: true });
      }
    }
  });

  test('a batch that finds its database closed under it fails on its own, without reaching the driver', () => {
    // An engine that misses its close deadline has its storage closed under
    // it, and a batch it still holds then flushes onto the closed database.
    const operations: string[] = [];
    const database = new NativeSqliteDatabase(
      nativeDatabase(':memory:', operations),
    );
    database.exec(GOSSIP_TABLE);
    database.close();
    operations.length = 0;
    expect(() =>
      database.transaction(() =>
        database.prepare(SAVE_CHANNEL).run('00', '{}'),
      )(),
    ).toThrow('database is closed');
    expect(operations).toEqual([]);
  });
});
