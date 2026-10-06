import React from 'react';
import { AppState, Text } from 'react-native';
import { act } from 'react-test-renderer';
import { DiagnosticsPanel } from '../src/scenes/settings/Diagnostics';
import {
  clearDiagnostics,
  recordDiagnostic,
} from '../src/services/diagnosticLog';
import {
  ENTRY_LIMIT,
  PERF_WINDOW_MS,
  TICK_MS,
  bootReport,
  engineMark,
  fit,
  stallSummary,
  tallySqlite,
} from '../src/services/perf';
import type { BootRecord, Mark, SqliteTally } from '../src/services/perf';
import type { WalletAdapter } from '../src/services/wallet';
import { mount } from '../test-support/guard';

/**
 * The boot report (src/services/perf): when each step of a cold start first
 * happened, the stalls the JS thread had, what SQLite did, and the reads and
 * refused taps, written down once a minute has passed. Only index.js starts
 * it, so each test that wants it running loads a module of its own and
 * starts that, on fake timers, and moves the clock itself.
 */

type Perf = typeof import('../src/services/perf');
type Log = typeof import('../src/services/diagnosticLog');

/**
 * A fresh copy of the report, and of the log it writes to. It reads the app
 * state as it runs, which is the one this file imports.
 */
function load() {
  let loaded!: { perf: Perf; log: Log };
  jest.isolateModules(() => {
    loaded = {
      perf: require('../src/services/perf'),
      log: require('../src/services/diagnosticLog'),
    };
  });
  return loaded;
}

const listen = jest.mocked(AppState.addEventListener);

let printed: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  listen.mockClear();
  printed = jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** What the report printed, without its prefix. */
const lines = () =>
  printed.mock.calls
    .map(([line]) => String(line))
    .filter(line => line.startsWith('CHICORY_PERF '))
    .map(line => line.slice('CHICORY_PERF '.length));

/** Holds the JS thread for `ms`: the clock moves and no timer runs. */
const stall = (ms: number) => {
  jest.setSystemTime(Date.now() + ms);
  jest.advanceTimersByTime(TICK_MS);
};

describe('a launch', () => {
  test('is written down once the window closes, five lines printed and logged', () => {
    const { perf, log } = load();
    perf.startBootPerf();
    expect(listen).toHaveBeenCalledWith('change', expect.any(Function));
    jest.advanceTimersByTime(100);
    perf.markBoot('engine-loaded');
    stall(300);
    perf.markBoot('canvas-painted');
    stall(1200);
    perf.markEngine(
      'gossip-synced download 300ms apply 4200ms busy 1900ms slices 230',
    );
    // A batch of the network map, a write that commits alone, and the map
    // read back.
    perf.noteSqlite('BEGIN IMMEDIATE', 1, 0, true);
    for (let i = 0; i < 3; i++)
      perf.noteSqlite(
        'INSERT OR REPLACE INTO gossip_channels (scid_hex, channel_json) VALUES (?, ?)',
        2,
        0,
        false,
      );
    perf.noteSqlite('COMMIT', 5, 0, false);
    perf.noteSqlite('INSERT INTO payments VALUES (?)', 3, 0, true);
    perf.noteSqlite('SELECT channel_json FROM gossip_channels', 40, 250, true);
    perf.noteRead(120, false);
    perf.noteRead(80, true);
    perf.noteRefusedTap();
    perf.noteRefusedTap();
    // A step seen again keeps the time it first happened.
    perf.markBoot('engine-loaded');
    expect(lines()).toEqual([]);
    jest.advanceTimersByTime(PERF_WINDOW_MS);
    expect(lines()).toEqual([
      'boot engine-loaded 100, canvas-painted 450',
      'engine gossip-synced 1700 (download 300ms apply 4200ms busy 1900ms slices 230)',
      'sqlite 7 statements 55ms, commits 2 (1 alone), longest 40ms "SELECT channel_json FROM gossip_", gossip 3 writes 250 rows',
      'stalls 2 over 100ms, 2 over 250ms, 1 over 1s, longest 1200ms at 500, total 1500ms, 62s watched; 15s after paint 1 over 100ms, 1 over 250ms, 1 over 1s, longest 1200ms at 500, total 1200ms; reads 2 (1 overlapped) 200ms, longest 120ms; refused taps 2',
      'hitches 300ms at 150, 1200ms at 500',
    ]);
    // The same lines go to Settings > Diagnostics' copied report.
    const logged = log.recentDiagnostics().filter(e => e.phase === 'perf');
    expect(logged.map(entry => entry.message)).toEqual(lines());
    // And then it is done: no timer left, nothing more recorded or said.
    expect(jest.getTimerCount()).toBe(0);
    expect(listen.mock.results[0].value.remove).toHaveBeenCalled();
    perf.markBoot('late');
    perf.startBootPerf();
    jest.advanceTimersByTime(PERF_WINDOW_MS);
    expect(lines()).toHaveLength(5);
  });

  test('records nothing and runs nothing until it is started', () => {
    const { perf, log } = load();
    perf.markBoot('engine-loaded');
    perf.markEngine('create 812ms');
    perf.noteSqlite('COMMIT', 5, 0, false);
    perf.noteRead(10, true);
    perf.noteRefusedTap();
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(PERF_WINDOW_MS * 2);
    expect(lines()).toEqual([]);
    expect(log.recentDiagnostics()).toEqual([]);
    // Started later, it holds only what came after.
    perf.startBootPerf();
    jest.advanceTimersByTime(PERF_WINDOW_MS);
    expect(lines()).toEqual([
      'boot none',
      'engine none',
      'sqlite none',
      'stalls none, 60s watched; no paint; reads 0 (0 overlapped) 0ms, longest 0ms; refused taps 0',
      'hitches none',
    ]);
  });

  test('does not count the time the app spends in the background as a stall', () => {
    const { perf } = load();
    perf.startBootPerf();
    const [[event, watch]] = listen.mock.calls as unknown as [
      string,
      (state: string) => void,
    ][];
    expect(event).toBe('change');
    jest.advanceTimersByTime(1000);
    watch('background');
    stall(20000);
    watch('active');
    jest.advanceTimersByTime(1000);
    stall(150);
    jest.advanceTimersByTime(PERF_WINDOW_MS);
    const [, , , stalls, hitches] = lines();
    expect(stalls).toMatch(/^stalls 1 over 100ms, 0 over 250ms, 0 over 1s/);
    expect(hitches).toBe('hitches none');
    // The background stretch is not counted as watched either.
    expect(stalls).toContain(
      `${Math.round((PERF_WINDOW_MS + 150) / 1000)}s watched`,
    );
  });
});

describe('its arithmetic', () => {
  const tally = (): SqliteTally => ({
    statements: 0,
    commits: 0,
    alone: 0,
    ms: 0,
    longestMs: 0,
    longest: '',
    gossipWrites: 0,
    gossipRows: 0,
  });

  test('a commit is a COMMIT, or a write outside any transaction', () => {
    const sqlite = tally();
    tallySqlite(sqlite, 'COMMIT', 1, 0, false);
    tallySqlite(sqlite, 'END TRANSACTION', 1, 0, false);
    tallySqlite(sqlite, 'RELEASE SAVEPOINT beignet_3', 1, 0, false);
    tallySqlite(sqlite, 'INSERT INTO t VALUES (?)', 1, 0, false);
    tallySqlite(sqlite, '  update t SET a = ?', 1, 0, true);
    tallySqlite(sqlite, 'DELETE FROM t', 1, 0, true);
    tallySqlite(sqlite, 'SELECT * FROM t', 1, 4, true);
    tallySqlite(sqlite, 'PRAGMA wal_checkpoint(TRUNCATE)', 1, 1, true);
    expect(sqlite).toMatchObject({ statements: 8, commits: 4, alone: 2 });
  });

  test('the network map counts its writes and the rows read back, and nothing else', () => {
    const sqlite = tally();
    tallySqlite(
      sqlite,
      'INSERT OR REPLACE INTO gossip_nodes (node_id_hex, node_json) VALUES (?, ?)',
      1,
      0,
      false,
    );
    tallySqlite(
      sqlite,
      'DELETE FROM gossip_channels WHERE scid_hex = ?',
      1,
      0,
      false,
    );
    tallySqlite(sqlite, 'SELECT node_json FROM gossip_nodes', 1, 40, true);
    tallySqlite(sqlite, 'SELECT * FROM channels', 1, 9, true);
    tallySqlite(
      sqlite,
      'CREATE TABLE IF NOT EXISTS gossip_channels (scid_hex TEXT)',
      1,
      0,
      true,
    );
    expect(sqlite).toMatchObject({ gossipWrites: 2, gossipRows: 40 });
  });

  test('the slowest statement keeps the start of its text only', () => {
    const sqlite = tally();
    tallySqlite(sqlite, 'SELECT 1', 3, 1, true);
    tallySqlite(
      sqlite,
      '\n\t\tSELECT channel_id,   state_json FROM chain_monitors WHERE channel_id = ?',
      9,
      1,
      true,
    );
    tallySqlite(sqlite, 'SELECT 2', 4, 1, true);
    expect(sqlite.longestMs).toBe(9);
    expect(sqlite.longest).toBe('SELECT channel_id, state_json FR');
  });

  test('an engine timing is named by its first word, the rest its detail', () => {
    expect(engineMark('create 812ms')).toEqual(['create', '812ms']);
    expect(
      engineMark('gossip-synced download 300ms apply 4200ms busy 1900ms'),
    ).toEqual(['gossip-synced', 'download 300ms apply 4200ms busy 1900ms']);
    expect(engineMark(' initial-sync ')).toEqual(['initial-sync', undefined]);
    expect(engineMark('')).toEqual(['', undefined]);
  });

  test('stalls count in a window when any of them falls inside it', () => {
    const stalls = [
      { at: 100, ms: 300 },
      { at: 900, ms: 1200 },
      { at: 5000, ms: 120 },
    ];
    expect(stallSummary(stalls)).toEqual({
      count: 3,
      hitches: 2,
      frozen: 1,
      longest: { at: 900, ms: 1200 },
      total: 1620,
    });
    // One that ends as the window opens is before it; one running into it
    // is in it, whole.
    expect(stallSummary(stalls, 400, 5000)).toMatchObject({
      count: 1,
      total: 1200,
    });
    expect(stallSummary(stalls, 1000, 5001)).toMatchObject({
      count: 2,
      total: 1320,
    });
    expect(stallSummary([], 0, 10).longest).toBeNull();
  });

  test('a line too long for the log is cut after a whole item, and says so', () => {
    expect(fit('boot a 1, b 2')).toBe('boot a 1, b 2');
    const long = `boot ${Array.from(
      { length: 40 },
      (_, i) => `step-${i} ${1000 + i}`,
    ).join(', ')}`;
    const kept = fit(long);
    expect(kept.length).toBeLessThanOrEqual(ENTRY_LIMIT);
    expect(kept.endsWith(' …')).toBe(true);
    expect(long.startsWith(kept.slice(0, -2))).toBe(true);
    expect(kept.slice(0, -2)).toMatch(/step-\d+ \d+$/);
  });

  test('a slow launch with every step still logs each line whole or cut clean', () => {
    const marks = new Map<string, Mark>(
      [
        'engine-loaded',
        'open:probe',
        'open:device-volume',
        'vault-opened',
        'runtime-created',
        'page-hydrated',
        'canvas-painted',
        'open:mainnet.db',
        'engine-started',
        'first-live-read',
        'primary-connected',
      ].map((name, index) => [
        name,
        {
          at: 10000 + index * 4321,
          ...(name.startsWith('open:') ? { detail: '1234ms' } : {}),
        },
      ]),
    );
    for (const [name, detail] of [
      ['create', '8123ms'],
      ['initial-sync', '16400ms'],
      [
        'gossip-synced',
        'download 3000ms apply 42000ms busy 19000ms slices 2300',
      ],
    ])
      marks.set(name, { at: 59999, detail, engine: true });
    const record: BootRecord = {
      ran: 60000,
      watched: 60000,
      marks,
      stalls: Array.from({ length: 300 }, (_, i) => ({
        at: i * 190,
        ms: 100 + i,
      })),
      sqlite: {
        statements: 123456,
        commits: 54321,
        alone: 43210,
        ms: 98765,
        longestMs: 4321,
        longest: 'SELECT channel_json FROM gossip_c',
        gossipWrites: 99999,
        gossipRows: 55000,
      },
      reads: { count: 25, overlapped: 12, ms: 54321, longestMs: 9876 },
      refusedTaps: 14,
    };
    const report = bootReport(record);
    expect(report).toHaveLength(5);
    for (const line of report) {
      expect(fit(line).length).toBeLessThanOrEqual(ENTRY_LIMIT);
      expect(line.startsWith(fit(line).replace(/ …$/, ''))).toBe(true);
    }
    // The most telling figures lead, so a cut keeps them.
    expect(fit(report[1])).toContain('gossip-synced 59999');
    expect(fit(report[2])).toContain('gossip 99999 writes 55000 rows');
    expect(fit(report[3])).toContain('after paint');
    // The hitches come in the order they were seen, from the first that
    // held the thread HITCH_MS or more.
    expect(fit(report[4])).toMatch(/^hitches 250ms at 28500, 251ms at 28690, /);
  });

  test('a launch the thread never held long enough to feel says so', () => {
    const report = bootReport({
      ran: 60000,
      watched: 60000,
      marks: new Map(),
      stalls: [
        { at: 1000, ms: 120 },
        { at: 2000, ms: 249 },
      ],
      sqlite: {
        statements: 0,
        commits: 0,
        alone: 0,
        ms: 0,
        longestMs: 0,
        longest: '',
        gossipWrites: 0,
        gossipRows: 0,
      },
      reads: { count: 0, overlapped: 0, ms: 0, longestMs: 0 },
      refusedTaps: 0,
    });
    expect(report[4]).toBe('hitches none');
  });
});

describe('Settings > Diagnostics', () => {
  test('carries the report and the engine’s timings in its copy, and never lists them as errors', async () => {
    clearDiagnostics();
    recordDiagnostic({ phase: 'ui', message: 'No route was found.' });
    recordDiagnostic({
      phase: 'perf',
      message: 'boot engine-loaded 100, canvas-painted 450',
    });
    recordDiagnostic({ phase: 'engine-perf', message: 'create 812ms' });
    const client = {
      diagnostics: jest.fn().mockResolvedValue({ setup: 'ready' }),
    } as unknown as WalletAdapter;
    // What Settings > Help > Diagnostics opens, which reads the report as
    // it opens.
    const tree = await mount(<DiagnosticsPanel client={client} />);
    const drawn = (message: string) =>
      tree.root.findAll(
        node => node.type === Text && node.props.children === message,
      ).length;
    expect(drawn('No route was found.')).toBe(1);
    expect(drawn('boot engine-loaded 100, canvas-painted 450')).toBe(0);
    expect(drawn('create 812ms')).toBe(0);
    // The report the copy control copies holds every event, these too.
    const report = tree.root
      .findAll(
        node =>
          node.type === Text &&
          typeof node.props.children === 'string' &&
          node.props.children.includes('"events"'),
      )
      .map(node => node.props.children as string)
      .join('');
    expect(report).toContain('boot engine-loaded 100, canvas-painted 450');
    expect(report).toContain('create 812ms');
    await act(async () => tree.unmount());
    clearDiagnostics();
  });
});
