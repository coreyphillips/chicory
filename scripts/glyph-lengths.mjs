/**
 * Writes src/design/glyphLengths.ts: the length of every part of every glyph
 * in src/design/glyphs.tsx, for draw-in animations that dash a stroke by its
 * own length.
 *
 * Run from the repository root after changing a glyph:
 *
 *   node scripts/glyph-lengths.mjs
 *
 * The glyph table is read with the TypeScript parser rather than imported,
 * because glyphs.tsx pulls in React Native, which cannot load under Node.
 *
 * Lengths are measured here instead of with svg-path-properties, which returns
 * NaN for an arc whose radii are too small to reach its end point. The key
 * glyph has one, and renderers scale such radii up (SVG 1.1, F.6.6), so this
 * does the same. Lines are exact; curves and arcs are flattened finely enough
 * to agree with that library to the hundredth wherever it gives an answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'src/design/glyphs.tsx');
const TARGET = path.join(ROOT, 'src/design/glyphLengths.ts');

function readGlyphs() {
  const file = ts.createSourceFile(
    SOURCE,
    readFileSync(SOURCE, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declared = new Map();
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer) {
        declared.set(declaration.name.getText(file), declaration.initializer);
      }
    }
  }

  const unwrap = node => {
    while (
      ts.isSatisfiesExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node)
    ) {
      node = node.expression;
    }
    if (ts.isIdentifier(node)) {
      const target = declared.get(node.text);
      if (!target) throw new Error(`Unknown constant ${node.text}`);
      return unwrap(target);
    }
    return node;
  };

  const part = node => {
    const object = unwrap(node);
    if (!ts.isObjectLiteralExpression(object)) {
      throw new Error(`Expected a part at ${object.getText(file)}`);
    }
    const fields = {};
    for (const property of object.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isStringLiteralLike(property.initializer)
      ) {
        fields[property.name.getText(file)] = property.initializer.text;
      }
    }
    if (!fields.id || !fields.d) {
      throw new Error(
        `A part needs a literal id and d: ${object.getText(file)}`,
      );
    }
    return fields;
  };

  const parts = node => {
    const array = unwrap(node);
    if (!ts.isArrayLiteralExpression(array)) {
      throw new Error(`Expected a list of parts at ${array.getText(file)}`);
    }
    return array.elements.flatMap(element =>
      ts.isSpreadElement(element) ? parts(element.expression) : [part(element)],
    );
  };

  return unwrap(declared.get('GLYPHS')).properties.map(property => [
    property.name.getText(file),
    parts(property.initializer),
  ]);
}

const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i;

/** Path data as a list of { command, args }, implicit repeats made explicit. */
function parse(d) {
  const out = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = () => {
    skip();
    const match = NUMBER.exec(d.slice(i));
    if (!match) throw new Error(`Expected a number at ${i} in ${d}`);
    i += match[0].length;
    return Number(match[0]);
  };
  // Arc flags are single digits and may be written without separators.
  const flag = () => {
    skip();
    const digit = d[i++];
    if (digit !== '0' && digit !== '1') {
      throw new Error(`Expected an arc flag at ${i - 1} in ${d}`);
    }
    return digit === '1';
  };
  let command = null;
  for (skip(); i < d.length; skip()) {
    if (/[a-z]/i.test(d[i])) command = d[i++];
    if (!command) throw new Error(`Expected a command at ${i} in ${d}`);
    const kind = command.toUpperCase();
    const args =
      kind === 'A'
        ? [number(), number(), number(), flag(), flag(), number(), number()]
        : Array.from({ length: ARITY[kind] }, number);
    out.push({ command, args });
    // Coordinates after a moveto are linetos; after a closepath, nothing is.
    if (kind === 'M') command = command === 'M' ? 'L' : 'l';
    if (kind === 'Z') command = null;
  }
  return out;
}

const STEPS = 2000;
function sampled(at) {
  let total = 0;
  let [px, py] = at(0);
  for (let step = 1; step <= STEPS; step++) {
    const [x, y] = at(step / STEPS);
    total += Math.hypot(x - px, y - py);
    [px, py] = [x, y];
  }
  return total;
}

const bezier = points => t => {
  let row = points;
  while (row.length > 1) {
    row = row
      .slice(1)
      .map(([x, y], k) => [
        row[k][0] + (x - row[k][0]) * t,
        row[k][1] + (y - row[k][1]) * t,
      ]);
  }
  return row[0];
};

/** SVG 1.1 F.6.5, endpoint to centre parameterization, with F.6.6 scaling. */
function arc([x1, y1], [rx, ry, rotation, large, sweep], [x2, y2]) {
  if (x1 === x2 && y1 === y2) return 0;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) return Math.hypot(x2 - x1, y2 - y1);
  const phi = (rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(phi), Math.sin(phi)];
  const [dx, dy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const [xp, yp] = [cos * dx + sin * dy, -sin * dx + cos * dy];
  const reach = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (reach > 1) {
    rx *= Math.sqrt(reach);
    ry *= Math.sqrt(reach);
  }
  const numerator = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const denominator = rx * rx * yp * yp + ry * ry * xp * xp;
  const k =
    (large === sweep ? -1 : 1) *
    Math.sqrt(Math.max(0, numerator / denominator));
  const [cxp, cyp] = [(k * rx * yp) / ry, (-k * ry * xp) / rx];
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const [ux, uy] = [(xp - cxp) / rx, (yp - cyp) / ry];
  const start = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  return sampled(t => {
    const theta = start + delta * t;
    const [ex, ey] = [rx * Math.cos(theta), ry * Math.sin(theta)];
    return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy];
  });
}

function pathLength(d) {
  let total = 0;
  let at = [0, 0];
  let start = at;
  let control = null;
  for (const { command, args } of parse(d)) {
    const kind = command.toUpperCase();
    const [ox, oy] = command === kind ? [0, 0] : at;
    const point = (x, y) => [ox + x, oy + y];
    const mirror = expected =>
      control?.kind === expected
        ? [2 * at[0] - control.point[0], 2 * at[1] - control.point[1]]
        : at;
    let next;
    let nextControl = null;
    switch (kind) {
      case 'M':
        next = start = point(args[0], args[1]);
        break;
      case 'L':
        next = point(args[0], args[1]);
        break;
      case 'H':
        next = [ox + args[0], at[1]];
        break;
      case 'V':
        next = [at[0], oy + args[0]];
        break;
      case 'Z':
        next = start;
        break;
      case 'C':
      case 'S': {
        const [first, second, end] =
          kind === 'C'
            ? [
                point(args[0], args[1]),
                point(args[2], args[3]),
                point(args[4], args[5]),
              ]
            : [mirror('C'), point(args[0], args[1]), point(args[2], args[3])];
        total += sampled(bezier([at, first, second, end]));
        nextControl = { kind: 'C', point: second };
        next = end;
        break;
      }
      case 'Q':
      case 'T': {
        const [handle, end] =
          kind === 'Q'
            ? [point(args[0], args[1]), point(args[2], args[3])]
            : [mirror('Q'), point(args[0], args[1])];
        total += sampled(bezier([at, handle, end]));
        nextControl = { kind: 'Q', point: handle };
        next = end;
        break;
      }
      case 'A':
        next = point(args[5], args[6]);
        total += arc(at, args, next);
        break;
    }
    if ('LHVZ'.includes(kind)) {
      total += Math.hypot(next[0] - at[0], next[1] - at[1]);
    }
    at = next;
    control = nextControl;
  }
  return total;
}

// Rounded up: a dash a hair longer than its stroke still covers it, while one
// a hair shorter leaves the last sliver undrawn. The tolerance keeps float
// noise, such as a .01 dot measuring .0100000001, from rounding up a step.
const hundredths = length => Math.ceil(length * 100 - 1e-6) / 100;
const rows = readGlyphs().map(([name, list]) => {
  const lengths = list.map(({ d }) => hundredths(pathLength(d)));
  return `  ${name}: [${lengths.join(', ')}],`;
});

writeFileSync(
  TARGET,
  `// Generated by scripts/glyph-lengths.mjs from src/design/glyphs.tsx. Do not
// edit by hand. After changing a glyph, regenerate from the repository root:
//
//   node scripts/glyph-lengths.mjs
//
// One length per part, in grid units, rounded up to the hundredth.
import type { GlyphName } from './glyphs';

export const GLYPH_LENGTHS: Record<GlyphName, number[]> = {
${rows.join('\n')}
};
`,
);
console.log(`Wrote ${rows.length} glyphs to ${path.relative(ROOT, TARGET)}`);
