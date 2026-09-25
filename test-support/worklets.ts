import { filesUnder, fs, path, ROOT } from './node';

/**
 * The worklet scan: UI-thread safety, read off the source.
 *
 * A worklet runs on the UI thread with only what the worklets plugin
 * captured for it. Jest runs every worklet on the JS thread instead, where
 * everything is in scope and any function can be called, and never runs a
 * layout animation or an animated reaction at all. So a worklet that cannot
 * run on the UI thread passes every rendering test and crashes on a device.
 * The scan reads the source the way the plugin does and reports the shapes
 * that crash or misbehave there. The WorkletSafety suite holds the app to
 * it and keeps the negative controls that prove it catches each one:
 *
 * - A parameter that reads an outer value. The plugin unpacks what it
 *   captured at the top of the body, where a parameter default cannot see
 *   it, so `function f(x = SOME_CONSTANT) { 'worklet'; ... }` throws the
 *   first time the default is used. The vessel's seedBob did.
 * - A call to a function that is not a worklet. It reaches the UI thread as
 *   a function that can only be scheduled back to the JS thread
 *   (scheduleOnRN), and calling it there throws. So does a global the UI
 *   thread does not have.
 * - A React ref or a module `let` read from a worklet: the worklet gets a
 *   frozen copy of each, as it was when the worklet was built. A worklet
 *   built as its module loads also reads nothing the module declares after
 *   it, which is still undefined then.
 * - A gesture callback or layout animation that the plugin does not turn
 *   into a worklet and that says 'worklet' nowhere itself.
 */
declare const require: (id: string) => any;
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

type Node = any;
type Path = any;

const parse = (source: string): Node =>
  parser.parse(source, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

function isWorklet(fn: Node): boolean {
  const body = fn?.body;
  return (
    body?.type === 'BlockStatement' &&
    (body.directives || []).some((d: any) => d.value.value === 'worklet')
  );
}

const FUNCTIONS = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
]);
const isFunction = (node: Node) => !!node && FUNCTIONS.has(node.type);

/** An expression without the TypeScript around it: `x as T`, `x!`. */
const WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ParenthesizedExpression',
]);
function bare(node: Node): Node {
  while (node && WRAPPERS.has(node.type)) node = node.expression;
  return node;
}
function barePath(p: Path): Path {
  while (p?.node && WRAPPERS.has(p.node.type)) p = p.get('expression');
  return p;
}

/** Whether `p` is `ancestor` or inside it. */
const within = (p: Path, ancestor: Path) =>
  !!p &&
  (p.node === ancestor.node ||
    !!p.findParent((q: Path) => q.node === ancestor.node));

const keyName = (prop: Node): string | undefined =>
  prop && !prop.computed ? prop.key?.name ?? prop.key?.value : undefined;

const isCallTo = (node: Node, names: string[]) =>
  node?.type === 'CallExpression' &&
  node.callee.type === 'Identifier' &&
  names.includes(node.callee.name);

/** Type annotations name no values, so every walk passes them by. */
const SKIP_TYPES = {
  'TSType|TSTypeAnnotation|TSTypeParameterDeclaration|TSTypeParameterInstantiation|TSInterfaceDeclaration|TSTypeAliasDeclaration'(
    p: Path,
  ) {
    p.skip();
  },
};

/*
 * Which functions run on the UI thread. Besides every function that says
 * 'worklet', the plugin turns these callbacks into worklets on its own
 * (react-native-worklets/plugin, autoworkletization): the listed arguments
 * of these calls, as a function or the name of one declared in the file.
 */
const CALLBACK_ARGS = new Map<string, number[]>([
  ['useFrameCallback', [0]],
  ['useAnimatedStyle', [0]],
  ['useAnimatedProps', [0]],
  ['createAnimatedPropAdapter', [0]],
  ['useDerivedValue', [0]],
  ['useAnimatedScrollHandler', [0]],
  ['useAnimatedReaction', [0, 1]],
  ['withTiming', [2, 3]],
  ['withSpring', [2, 3]],
  ['withDecay', [1]],
  ['withRepeat', [3]],
  ['runOnUI', [0]],
  ['scheduleOnUI', [0]],
  ['runOnUISync', [0]],
  ['runOnUIAsync', [0]],
  ['executeOnUIRuntimeSync', [0]],
]);
/** Gesture Handler 3's hooks, whose config's callbacks become worklets. */
const GESTURE_HOOKS = new Set([
  'useTapGesture',
  'usePanGesture',
  'usePinchGesture',
  'useRotationGesture',
  'useFlingGesture',
  'useLongPressGesture',
  'useNativeGesture',
  'useManualGesture',
  'useHoverGesture',
]);
/** The builder's callbacks, as in `Gesture.Pan().onUpdate(...)`. */
const BUILDER_CALLBACKS = new Set([
  'onBegin',
  'onStart',
  'onEnd',
  'onFinalize',
  'onUpdate',
  'onChange',
  'onTouchesDown',
  'onTouchesMove',
  'onTouchesUp',
  'onTouchesCancelled',
]);
const GESTURES = new Set([
  'Tap',
  'Pan',
  'Pinch',
  'Rotation',
  'Fling',
  'LongPress',
  'ForceTouch',
  'Native',
  'Manual',
  'Race',
  'Simultaneous',
  'Exclusive',
  'Hover',
]);

function fromGesture(node: Node): boolean {
  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression'
  )
    return false;
  const { object, property } = node.callee;
  if (object.type === 'Identifier' && object.name === 'Gesture')
    return GESTURES.has(property.name);
  return fromGesture(object);
}

/** What a constant name in the file stands for, as the plugin follows it. */
function definedAs(id: Path): Path | undefined {
  const binding = id.scope.getBinding(id.node.name);
  if (!binding) return undefined;
  if (binding.path.isFunctionDeclaration()) return binding.path;
  if (!binding.constant || !binding.path.isVariableDeclarator())
    return undefined;
  const init = barePath(binding.path.get('init'));
  return init?.isIdentifier() ? definedAs(init) : init;
}

/** The functions the plugin makes worklets of, given `arg`. */
function workletized(arg: Path, functions: boolean, objects: boolean): Path[] {
  let target = barePath(arg);
  if (target?.isIdentifier()) target = definedAs(target);
  if (!target?.node) return [];
  if (functions && isFunction(target.node)) return [target];
  if (!objects || !target.isObjectExpression()) return [];
  return target.get('properties').flatMap((prop: Path) => {
    if (prop.isObjectMethod()) return [prop];
    if (prop.isObjectProperty())
      return workletized(prop.get('value'), true, false);
    return [];
  });
}

/** The object `useMemo(() => ({ ... }))` makes, if it says so plainly. */
function memoized(call: Path): Path | undefined {
  const make = barePath(call.get('arguments.0'));
  if (!make?.node || !isFunction(make.node)) return undefined;
  const body = make.get('body');
  if (!body.isBlockStatement()) return barePath(body);
  const last = body
    .get('body')
    .filter((s: Path) => s.isReturnStatement())
    .pop();
  return last ? barePath(last.get('argument')) : undefined;
}

type Problem = [line: number, message: string];

interface Found {
  /** The UI-thread functions, each with why it is one. */
  functions: Map<Node, { fn: Path; why: string }>;
  problems: Problem[];
}

/**
 * A gesture config's callbacks. The plugin makes worklets of them when the
 * object is written in the call or in a constant it names. It cannot see
 * into one a `useMemo` builds, so each callback there needs 'worklet' of its
 * own. Gesture Handler keeps every callback on the JS thread when the config
 * says `runOnJS: true`, whatever the plugin made of it.
 */
function gestureConfig(arg: Path, found: Found, onJs: Set<Node>) {
  let config = barePath(arg);
  let seen = true;
  if (config?.isIdentifier()) config = definedAs(config);
  if (config?.node && isCallTo(config.node, ['useMemo'])) {
    config = memoized(config);
    seen = false;
  }
  if (!config?.isObjectExpression()) return;
  const jsThread = config.node.properties.some(
    (p: Node) =>
      keyName(p) === 'runOnJS' &&
      p.value?.type === 'BooleanLiteral' &&
      p.value.value,
  );
  for (const prop of config.get('properties')) {
    const key = keyName(prop.node);
    if (!key || !/^on[A-Z]/.test(key)) continue;
    const fn = prop.isObjectMethod()
      ? prop
      : workletized(prop.get('value'), true, false)[0];
    if (!fn) continue;
    if (jsThread) onJs.add(fn.node);
    else if (seen || isWorklet(fn.node))
      found.functions.set(fn.node, { fn, why: 'gesture' });
    else
      found.problems.push([
        fn.node.loc.start.line,
        `the gesture callback ${key} is not a worklet: the plugin cannot see into its config, so it needs its own 'worklet'`,
      ]);
  }
}

function uiFunctions(ast: Node): Found {
  const found: Found = { functions: new Map(), problems: [] };
  const onJs = new Set<Node>();
  const add = (fn: Path, why: string) => {
    if (!found.functions.has(fn.node))
      found.functions.set(fn.node, { fn, why });
  };
  traverse(ast, {
    Function(p: Path) {
      if (isWorklet(p.node)) add(p, 'directive');
    },
    CallExpression(p: Path) {
      const callee = p.node.callee;
      const name =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && !callee.computed
          ? callee.property.name
          : undefined;
      if (!name) return;
      const args = p.get('arguments');
      if (GESTURE_HOOKS.has(name)) {
        if (args[0]) gestureConfig(args[0], found, onJs);
        return;
      }
      const indexes = CALLBACK_ARGS.get(name);
      if (indexes) {
        const objects = name === 'useAnimatedScrollHandler';
        for (const i of indexes)
          if (args[i])
            for (const fn of workletized(args[i], true, objects)) add(fn, name);
      } else if (BUILDER_CALLBACKS.has(name) && fromGesture(callee.object)) {
        for (const arg of args)
          for (const fn of workletized(arg, true, true)) add(fn, 'gesture');
      }
    },
  });
  for (const node of onJs) found.functions.delete(node);
  return found;
}

/**
 * The places a worklet's parameters read a value from outside them, as
 * `[line, text]`: a default or a computed key that names a constant, an
 * import or a value of the function around the worklet. Globals and the
 * worklet's other parameters are fine: both are there before the body runs.
 */
function outerInParams(fn: Path, source: string): Problem[] {
  const hits: Problem[] = [];
  for (const param of fn.get('params')) {
    param.traverse({
      ...SKIP_TYPES,
      ReferencedIdentifier(id: Path) {
        const binding = id.scope.getBinding(id.node.name);
        if (!binding || binding.scope.path.node === fn.node) return;
        const holder = id.findParent(
          (q: Path) =>
            q.node === fn.node ||
            q.isAssignmentPattern() ||
            q.isObjectProperty(),
        );
        const shown = holder && holder.node !== fn.node ? holder : id;
        hits.push([
          shown.node.loc.start.line,
          source.slice(shown.node.start, shown.node.end),
        ]);
      },
    });
  }
  return hits;
}

/*
 * The files the scan reads, and where their imports lead.
 */

/** Where the scan reads files: the app's source, or a set of snippets. */
export interface Sources {
  /** The files whose worklets are checked. */
  files: string[];
  /** A file's text, or undefined when there is no such file. */
  read(file: string): string | undefined;
  /** How a report names a file. */
  name(file: string): string;
}

interface Module {
  source: string;
  ast: Node;
  /** Each top-level name and what defines it. */
  locals: Map<string, Node>;
  /** The top-level names declared with `let` or `var`, and which. */
  lets: Map<string, string>;
  imports: Map<string, { from: string; name: string }>;
  exports: Map<string, { local: string } | { from: string; name: string }>;
  stars: string[];
}

type Definition =
  | { kind: 'node'; node: Node; file: string; name: string }
  | { kind: 'namespace'; file: string }
  | { kind: 'package'; from: string; name: string }
  | undefined;

function readModule(source: string): Module {
  const ast = parse(source);
  const m: Module = {
    source,
    ast,
    locals: new Map(),
    lets: new Map(),
    imports: new Map(),
    exports: new Map(),
    stars: [],
  };
  for (const statement of ast.program.body) {
    let declaration = statement;
    if (statement.type === 'ImportDeclaration') {
      for (const s of statement.specifiers)
        m.imports.set(s.local.name, {
          from: statement.source.value,
          name:
            s.type === 'ImportDefaultSpecifier'
              ? 'default'
              : s.type === 'ImportNamespaceSpecifier'
              ? '*'
              : s.imported.name ?? s.imported.value,
        });
      continue;
    }
    if (statement.type === 'ExportAllDeclaration') {
      m.stars.push(statement.source.value);
      continue;
    }
    if (statement.type === 'ExportNamedDeclaration') {
      for (const s of statement.specifiers) {
        const local =
          s.type === 'ExportNamespaceSpecifier' ? '*' : s.local.name;
        m.exports.set(
          s.exported.name ?? s.exported.value,
          statement.source
            ? { from: statement.source.value, name: local }
            : { local },
        );
      }
      declaration = statement.declaration;
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      declaration = statement.declaration;
      const local = declaration.id?.name ?? declaration.name ?? '*default';
      if (!declaration.id && declaration.type !== 'Identifier')
        m.locals.set(local, bare(declaration));
      m.exports.set('default', { local });
    }
    if (!declaration) continue;
    const names: [string, Node][] = [];
    if (
      declaration.id &&
      /^(Function|Class)Declaration$/.test(declaration.type)
    )
      names.push([declaration.id.name, declaration]);
    if (declaration.type === 'VariableDeclaration')
      for (const d of declaration.declarations) {
        if (d.id.type !== 'Identifier') continue;
        names.push([d.id.name, bare(d.init)]);
        if (declaration.kind !== 'const')
          m.lets.set(d.id.name, declaration.kind);
      }
    for (const [name, node] of names) {
      m.locals.set(name, node);
      if (statement.type === 'ExportNamedDeclaration')
        m.exports.set(name, { local: name });
    }
  }
  return m;
}

function project(sources: Sources) {
  const modules = new Map<string, Module | null>();
  const load = (file: string): Module | null => {
    if (!modules.has(file)) {
      const source = sources.read(file);
      modules.set(file, source === undefined ? null : readModule(source));
    }
    return modules.get(file)!;
  };
  const resolve = (from: string, spec: string): string | undefined => {
    if (!spec.startsWith('.')) return undefined;
    const base = path.join(from.slice(0, from.lastIndexOf('/')), spec);
    const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(
      end => base + end,
    );
    return [base, ...candidates].find(
      file => /\.tsx?$/.test(file) && !!load(file),
    );
  };
  const imported = (
    file: string,
    from: string,
    name: string,
    seen: Set<string>,
  ): Definition => {
    const target = resolve(file, from);
    if (!target)
      return from.startsWith('.') ? undefined : { kind: 'package', from, name };
    if (name === '*') return { kind: 'namespace', file: target };
    return exported(target, name, seen);
  };
  const exported = (
    file: string,
    name: string,
    seen: Set<string>,
  ): Definition => {
    const m = load(file);
    if (!m || seen.has(`${file}#${name}`)) return undefined;
    seen.add(`${file}#${name}`);
    const entry = m.exports.get(name);
    if (entry && 'local' in entry) return local(file, entry.local, seen);
    if (entry) return imported(file, entry.from, entry.name, seen);
    for (const from of m.stars) {
      if (name === 'default' || !from.startsWith('.')) continue;
      const found = imported(file, from, name, seen);
      if (found) return found;
    }
    return undefined;
  };
  const local = (
    file: string,
    name: string,
    seen = new Set<string>(),
  ): Definition => {
    const m = load(file)!;
    if (m.locals.has(name)) {
      const node = m.locals.get(name);
      if (node?.type !== 'Identifier' || seen.has(`${file}@${name}`))
        return { kind: 'node', node, file, name };
      seen.add(`${file}@${name}`);
      return local(file, node.name, seen);
    }
    const from = m.imports.get(name);
    return from ? imported(file, from.from, from.name, seen) : undefined;
  };
  /** What `object.key` is, when `object` is a namespace or object literal. */
  const member = (object: Definition, key: string): Definition => {
    if (object?.kind === 'namespace')
      return exported(object.file, key, new Set());
    if (object?.kind === 'package')
      return {
        kind: 'package',
        from: object.from,
        name: `${object.name}.${key}`,
      };
    if (object?.kind !== 'node' || object.node?.type !== 'ObjectExpression')
      return undefined;
    const prop = object.node.properties.find((p: Node) => keyName(p) === key);
    if (!prop) return undefined;
    const value = prop.type === 'ObjectMethod' ? prop : bare(prop.value);
    if (value?.type === 'Identifier') return local(object.file, value.name);
    return { kind: 'node', node: value, file: object.file, name: key };
  };
  return { load, local, member };
}

/*
 * What a worklet may call and read.
 */

/** Reanimated's and Worklets' own worklets, safe to call on the UI thread. */
const PACKAGE_WORKLETS: Record<string, Set<string>> = {
  'react-native-reanimated': new Set([
    'withTiming',
    'withSpring',
    'withDecay',
    'withRepeat',
    'withSequence',
    'withDelay',
    'interpolate',
    'interpolateColor',
    'clamp',
    'Easing',
    'cancelAnimation',
    'scheduleOnRN',
    'runOnJS',
    'measure',
    'scrollTo',
    'getRelativeCoords',
  ]),
  'react-native-worklets': new Set(['scheduleOnRN', 'runOnJS']),
};
/** Globals the UI thread has, called by name. */
const GLOBAL_CALLS = new Set([
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Number',
  'String',
  'Boolean',
  'Array',
  'Date',
  'Map',
  'Set',
  'Error',
]);
/** Globals the UI thread has, called through, as in `Math.max`. */
const GLOBAL_OBJECTS = new Set([
  'Math',
  'Number',
  'Object',
  'Array',
  'String',
  'JSON',
  'Date',
  'console',
]);

/** Words in a file that can put a function on the UI thread. */
const MAY_HOLD_WORKLETS =
  /worklet|use\w*(Animated|Derived|Frame|Gesture)|with(Timing|Spring|Decay|Repeat)|runOnUI|scheduleOnUI|Gesture\.|initialValues/;

export interface WorkletScan {
  /** Every problem found, as `file:line: what`. */
  problems: string[];
  /**
   * How many UI-thread functions the scan read, by why each is one: its own
   * directive, a gesture, or the hook or animation that takes it.
   */
  kinds: Map<string, number>;
}

/**
 * Every worklet in `sources`, checked.
 *
 * A call is judged by where its callee is defined: a function declared in
 * the worklet is its own; one in the module, imported from another file in
 * `sources`, or held in an object literal there, must say 'worklet'; one
 * from a package must be one of Reanimated's own; a state setter or a
 * `useCallback` of the component around the worklet never is one. What the
 * scan cannot see through, such as a prop or a shared value's methods, it
 * leaves alone.
 */
export function scanWorklets(sources: Sources): WorkletScan {
  const { load, local, member } = project(sources);
  const out = new Set<string>();
  const kinds = new Map<string, number>();
  for (const file of sources.files) {
    if (!MAY_HOLD_WORKLETS.test(sources.read(file) ?? '')) continue;
    const m = load(file)!;
    const report = (line: number, message: string) =>
      out.add(`${sources.name(file)}:${line}: ${message}`);
    const { functions, problems } = uiFunctions(m.ast);
    problems.forEach(([line, message]) => report(line, message));
    for (const { why } of functions.values())
      kinds.set(why, (kinds.get(why) ?? 0) + 1);
    const ui = [...functions.values()].map(found => found.fn);

    const judge = (definition: Definition, shown: string) => {
      if (definition?.kind === 'package')
        return PACKAGE_WORKLETS[definition.from]?.has(
          definition.name.split('.')[0],
        )
          ? undefined
          : `calls ${shown} from ${definition.from}, which is not a worklet`;
      if (definition?.kind !== 'node') return undefined;
      const where = sources.name(definition.file);
      if (definition.node?.type === 'ClassDeclaration')
        return `builds ${shown} (${where}), a class the UI thread does not have`;
      if (isFunction(definition.node) && !isWorklet(definition.node))
        return `calls ${shown} (${where}), which is not a worklet`;
      return undefined;
    };

    const calleeByName = (
      id: Path,
      fn: Path,
      shown: string,
    ): string | undefined => {
      const name = id.node.name;
      const binding = id.scope.getBinding(name);
      if (!binding)
        return GLOBAL_CALLS.has(name)
          ? undefined
          : `calls ${shown}, which the UI thread does not have`;
      const declared = binding.path;
      const alias =
        declared.isVariableDeclarator() &&
        declared.node.id.type === 'Identifier' &&
        binding.constant
          ? barePath(declared.get('init'))
          : undefined;
      if (within(binding.scope.path, fn)) {
        // A worklet's own alias, as in `const f = helper`, is still `helper`.
        return alias?.isIdentifier()
          ? calleeByName(alias, fn, shown)
          : undefined;
      }
      if (binding.kind === 'module' || binding.scope.path.isProgram())
        return judge(local(file, name), shown);
      // A name from the component or hook around the worklet.
      if (declared.isFunctionDeclaration())
        return isWorklet(declared.node)
          ? undefined
          : `calls ${shown}, which is not a worklet`;
      if (!declared.isVariableDeclarator()) return undefined;
      const init = bare(declared.node.init);
      if (declared.node.id.type === 'ArrayPattern')
        return isCallTo(init, ['useState', 'useReducer'])
          ? `calls ${shown}, a state setter, which runs only on the JS thread: schedule it with scheduleOnRN`
          : undefined;
      if (isFunction(init) && !isWorklet(init))
        return `calls ${shown}, which is not a worklet`;
      if (isCallTo(init, ['useCallback']))
        return `calls ${shown}, a JS callback, which runs only on the JS thread: schedule it with scheduleOnRN`;
      return alias?.isIdentifier() ? calleeByName(alias, fn, shown) : undefined;
    };

    const callee = (call: Path, fn: Path): string | undefined => {
      const target = barePath(call.get('callee'));
      const shown = m.source.slice(target.node.start, target.node.end);
      if (target.isIdentifier()) return calleeByName(target, fn, shown);
      const keys: string[] = [];
      let object = target;
      while (
        object.isMemberExpression() ||
        object.isOptionalMemberExpression()
      ) {
        const property = object.node.property;
        if (object.node.computed && property.type !== 'StringLiteral')
          return undefined;
        keys.unshift(property.name ?? property.value);
        object = barePath(object.get('object'));
      }
      if (!object.isIdentifier() || !keys.length) return undefined;
      const binding = object.scope.getBinding(object.node.name);
      if (!binding)
        return GLOBAL_OBJECTS.has(object.node.name)
          ? undefined
          : `calls ${shown}, which the UI thread does not have`;
      if (within(binding.scope.path, fn)) return undefined;
      if (binding.kind !== 'module' && !binding.scope.path.isProgram())
        return undefined;
      let definition = local(file, object.node.name);
      for (const key of keys) definition = member(definition, key);
      return judge(definition, shown);
    };

    /** A module `let` or `var` that `name` reads, and which kind it is. */
    const moduleLet = (binding: any, name: string): string | undefined => {
      if (binding.kind !== 'module')
        return binding.kind === 'let' || binding.kind === 'var'
          ? binding.kind
          : undefined;
      const definition = local(file, name);
      if (definition?.kind !== 'node') return undefined;
      return load(definition.file)!.lets.get(definition.name);
    };

    for (const fn of ui) {
      for (const [line, text] of outerInParams(fn, m.source))
        report(
          line,
          `a parameter reads an outer value, which the UI thread never gets: ${text}`,
        );
      // A worklet inside another is read as part of the outer one.
      if (ui.some(other => other !== fn && within(fn.parentPath, other)))
        continue;
      const moduleLevel = !fn.parentPath.getFunctionParent();
      fn.traverse({
        ...SKIP_TYPES,
        'CallExpression|OptionalCallExpression|NewExpression'(call: Path) {
          const problem = callee(call, fn);
          if (problem) report(call.node.loc.start.line, problem);
        },
        ReferencedIdentifier(id: Path) {
          if (id.isJSXIdentifier()) return;
          const binding = id.scope.getBinding(id.node.name);
          if (!binding || within(binding.scope.path, fn)) return;
          const name = id.node.name;
          const line = id.node.loc.start.line;
          const declared = binding.path;
          if (
            declared.isVariableDeclarator() &&
            isCallTo(bare(declared.node.init), ['useRef', 'createRef'])
          )
            report(
              line,
              `reads the ref ${name}, which the UI thread gets only a frozen copy of`,
            );
          if (!binding.scope.path.isProgram()) return;
          const kind = moduleLet(binding, name);
          if (kind)
            report(
              line,
              `reads the module ${kind} ${name}, which the worklet copies once, as it is built`,
            );
          // Hoisting still holds for a function that is not a worklet; the
          // plugin rebuilds a worklet where it stands.
          const hoisted =
            binding.kind === 'hoisted' && !isWorklet(declared.node);
          if (
            moduleLevel &&
            binding.kind !== 'module' &&
            !hoisted &&
            declared.node !== fn.node &&
            declared.node.end > fn.node.start
          )
            report(
              line,
              `reads ${name} before the module declares it, as the worklet is built`,
            );
        },
      });
    }

    // A layout animation runs only on the UI thread, and only a directive
    // makes a worklet of it.
    traverse(m.ast, {
      ObjectExpression(o: Path) {
        const keys = o.node.properties.map(keyName);
        if (!keys.includes('initialValues') || !keys.includes('animations'))
          return;
        const fn = o.getFunctionParent();
        if (!fn || !ui.some(u => within(fn, u)))
          report(
            o.node.loc.start.line,
            'a layout animation that is not a worklet',
          );
      },
    });
  }
  return { problems: [...out].sort(), kinds };
}

/** The parameter problems in one file's worklets, as `line: text`. */
export function uncapturedDefaults(source: string): string[] {
  const hits: string[] = [];
  for (const { fn } of uiFunctions(parse(source)).functions.values())
    for (const [line, text] of outerInParams(fn, source))
      hits.push(`${line}: ${text}`);
  return hits;
}

/** The app's source files, which ship to the device; its tests do not. */
export function appSources(): Sources {
  const files = filesUnder(path.join(ROOT, 'src'), /\.(ts|tsx)$/).filter(
    file => !file.includes('/__tests__/'),
  );
  return {
    files,
    read: file =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined,
    name: file => path.relative(ROOT, file),
  };
}
