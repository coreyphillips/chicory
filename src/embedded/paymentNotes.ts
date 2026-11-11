import type { PaymentNoteStore } from '../services/paymentNotes';
import type { NativeSqliteDatabase } from './sqlite';

/** A separate table in device-volume, covered by its SQLCipher key and erase. */
export function openPaymentNotes(db: NativeSqliteDatabase): PaymentNoteStore {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_notes (
    scope TEXT NOT NULL, payment TEXT NOT NULL, note TEXT NOT NULL,
    address TEXT, PRIMARY KEY(scope, payment)
  )`);
  return {
    read(scope) {
      const rows = db
        .prepare(
          'SELECT payment, note, address FROM payment_notes WHERE scope = ?',
        )
        .all(scope);
      return new Map(
        rows.map(row => [
          String(row.payment),
          {
            text: String(row.note),
            address: typeof row.address === 'string' ? row.address : undefined,
          },
        ]),
      );
    },
    save(scope, key, note) {
      if (note.text) {
        db.prepare(
          `INSERT INTO payment_notes(scope, payment, note, address) VALUES (?, ?, ?, ?)
          ON CONFLICT(scope, payment) DO UPDATE SET note = excluded.note,
          address = COALESCE(excluded.address, address)`,
        ).run(scope, key, note.text, note.address ?? null);
      } else {
        db.prepare(
          'DELETE FROM payment_notes WHERE scope = ? AND payment = ?',
        ).run(scope, key);
      }
    },
    move(scope, moves) {
      db.transaction(() => {
        const update = db.prepare(
          'UPDATE payment_notes SET payment = ? WHERE scope = ? AND payment = ?',
        );
        for (const [from, to] of moves) update.run(to, scope, from);
      })();
    },
  };
}
