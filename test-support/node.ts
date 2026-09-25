/**
 * Node's file access for the tests that read the repository itself.
 *
 * Jest runs under Node, but the app's TypeScript config leaves Node's types
 * out: they declare a global `Buffer` that clashes with the `buffer` package
 * the app ships. These few typed handles are all the tests need.
 */
declare const require: (id: string) => unknown;
declare const __dirname: string;

interface Entry {
  name: string;
  isDirectory(): boolean;
}
export const fs = require('fs') as {
  readFileSync(file: string, encoding: 'utf8'): string;
  writeFileSync(file: string, data: string): void;
  existsSync(file: string): boolean;
  readdirSync(dir: string, options: { withFileTypes: true }): Entry[];
};
export const path = require('path') as {
  join(...parts: string[]): string;
  relative(from: string, to: string): string;
};
export const env = (
  require('process') as { env: Record<string, string | undefined> }
).env;

/** The repository root, whichever worktree the tests run from. */
export const ROOT = path.join(__dirname, '..');

/** Every file under `dir` whose name matches `pattern`, depth first. */
export function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (pattern.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}
