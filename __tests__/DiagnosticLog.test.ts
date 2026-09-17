import {
  clearDiagnostics,
  recentDiagnostics,
  recordDiagnostic,
} from '../src/services/diagnosticLog';

beforeEach(() => clearDiagnostics());

test('events are kept oldest first with a timestamp and an optional code', () => {
  recordDiagnostic({ phase: 'peer:connect', message: 'ab'.repeat(33) });
  recordDiagnostic({ phase: 'node:error', message: 'boom', code: 'X' });
  const events = recentDiagnostics();
  expect(events.map(e => e.phase)).toEqual(['peer:connect', 'node:error']);
  expect(events[0].code).toBeUndefined();
  expect(events[1].code).toBe('X');
  expect(Date.parse(events[0].at)).not.toBeNaN();
});

test('the log is bounded and a long message is cut', () => {
  for (let i = 0; i < 100; i++)
    recordDiagnostic({ phase: 'tick', message: `${i}` });
  const events = recentDiagnostics();
  expect(events).toHaveLength(80);
  expect(events[0].message).toBe('20');
  recordDiagnostic({ phase: 'long', message: 'x'.repeat(1000) });
  expect(recentDiagnostics().at(-1)?.message).toHaveLength(300);
});

test('a reader gets a copy', () => {
  recordDiagnostic({ phase: 'a', message: 'b' });
  const events = recentDiagnostics();
  events[0].message = 'changed';
  expect(recentDiagnostics()[0].message).toBe('b');
});
