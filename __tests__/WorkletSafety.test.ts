import { filesUnder, fs, path, ROOT } from '../test-support/node';

/**
 * Worklets run on the UI thread with only the values the worklets plugin
 * captured from their body. A parameter default is not part of the body, so
 * `function f(x = SOME_CONSTANT) { 'worklet'; ... }` reads an identifier the
 * UI thread never received, and the app crashes the first time the default
 * is used there. Jest runs worklets on the JS thread, where the constant is
 * in scope, so no rendering test can see it. This scan can: every worklet's
 * parameter defaults must be literals.
 */
declare const require: (id: string) => any;
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const LITERAL = new Set([
  'NumericLiteral',
  'StringLiteral',
  'BooleanLiteral',
  'NullLiteral',
]);

function literal(node: any): boolean {
  if (LITERAL.has(node.type)) return true;
  return node.type === 'UnaryExpression' && LITERAL.has(node.argument.type);
}

function isWorklet(fn: any): boolean {
  const body = fn.body;
  return (
    body?.type === 'BlockStatement' &&
    (body.directives || []).some((d: any) => d.value.value === 'worklet')
  );
}

function defaultsIn(param: any, out: any[]) {
  if (!param || typeof param !== 'object') return;
  if (param.type === 'AssignmentPattern') {
    if (!literal(param.right)) out.push(param);
    defaultsIn(param.left, out);
    return;
  }
  if (param.type === 'ObjectPattern')
    param.properties.forEach((p: any) => defaultsIn(p.value ?? p, out));
  if (param.type === 'ArrayPattern')
    param.elements.forEach((e: any) => defaultsIn(e, out));
  if (param.type === 'RestElement') defaultsIn(param.argument, out);
  if (param.type === 'TSParameterProperty') defaultsIn(param.parameter, out);
}

export function uncapturedDefaults(source: string): string[] {
  const ast = parser.parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
  const found: string[] = [];
  traverse(ast, {
    Function(p: any) {
      if (!isWorklet(p.node)) return;
      const bad: any[] = [];
      p.node.params.forEach((param: any) => defaultsIn(param, bad));
      bad.forEach(b =>
        found.push(`${b.loc.start.line}: ${source.slice(b.start, b.end)}`),
      );
    },
  });
  return found;
}

test('no worklet reads an outer value through a parameter default', () => {
  const problems: string[] = [];
  for (const file of filesUnder(path.join(ROOT, 'src'), /\.(ts|tsx)$/)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('worklet')) continue;
    for (const hit of uncapturedDefaults(source))
      problems.push(`${path.relative(ROOT, file)}:${hit}`);
  }
  expect(problems).toEqual([]);
});

test('the scan catches the shape that crashed the vessel', () => {
  const source = `const SEEDS = 5;
export function seedBob(t: number, count = SEEDS) { 'worklet'; return t / count; }
export function fine(t: number, count = 5) { 'worklet'; return t / count; }
export function plain(t: number, count = SEEDS) { return t / count; }`;
  expect(uncapturedDefaults(source)).toEqual(['2: count = SEEDS']);
});
