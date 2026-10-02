/**
 * A JSON Schema validator, scoped to the keywords the 2026-07-28 wire schema uses.
 *
 * This exists because the official conformance runner cannot be installed here
 * (the `sfw` package wrapper writes to a root-owned cache directory), and because
 * `npm test` must not need a network install either way. The check being replaced
 * is `wire-schema-valid`, which validates every message an implementation sends
 * against the specification's JSON Schema.
 *
 * It is worth having precisely because of the faults this endpoint had: a missing
 * `supportedVersions`, missing `ttlMs` and `cacheScope`, and a missing
 * `resultType` on a tool result. Every one was a missing or wrongly shaped field
 * inside a correct `200`. The existing conformance suite asserts those fields by
 * name, which catches a regression but cannot catch an unexpected shape anywhere
 * else, because it only knows about the fields it already knows about.
 *
 * Scope, measured against the pinned schema rather than assumed:
 *
 *   supported   type, properties, required, additionalProperties, items, enum,
 *               const, anyOf, allOf, $ref, minimum, maximum
 *   ignored     format, title, description, default, examples — annotations,
 *               which by definition constrain nothing
 *   absent      oneOf, not, if/then/else, patternProperties, dependentSchemas,
 *               prefixItems, $dynamicRef — none appear in the reachable subset
 *
 * `assertReachableKeywords` fails if a future schema uses a keyword this does not
 * implement, so an unsupported construct cannot pass silently. That check is what
 * keeps this honest as the specification moves.
 *
 * Unknown keywords are not errors by design. JSON Schema says an implementation
 * MUST ignore keywords it does not recognise, and the pinned schema carries
 * annotations of its own (`$comment`, `deprecated`).
 */

/** Keywords that change what a value may be. Anything else is an annotation. */
const ANNOTATIONS = new Set([
  '$schema', '$id', '$comment', '$anchor', 'title', 'description', 'default',
  'examples', 'deprecated', 'readOnly', 'writeOnly', 'format', '$defs',
]);

/** Keywords this validator implements. */
const SUPPORTED = new Set([
  '$ref', 'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'anyOf', 'allOf', 'minimum', 'maximum', 'minLength',
  'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems',
  'propertyNames', 'multipleOf',
]);

/**
 * Keywords that are deliberately not implemented, and why. Each is a construct
 * whose meaning cannot be approximated; treating one as satisfied would make the
 * validator report conformance it has not checked.
 */
const UNSUPPORTED = new Set([
  'oneOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'dependentRequired',
  'dependentSchemas', 'patternProperties', 'prefixItems', 'contains',
  'unevaluatedProperties', 'unevaluatedItems', '$dynamicRef', '$recursiveRef',
]);

const TYPE_CHECKS = {
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  null: (v) => v === null,
};

/** `new URL`-free JSON Pointer escaping, per RFC 6901. */
function pointer(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Shallow equality, enough for `const` and `enum` on JSON values. */
function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => same(item, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return same(ka, kb) && ka.every((k) => same(a[k], b[k]));
  }
  // Number vs integer spelling: 1 and 1.0 are the same JSON value.
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return false;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) {
    throw new Error(`only local $ref is supported, got ${JSON.stringify(ref)}`);
  }
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === undefined || node === null || !(key in node)) {
      throw new Error(`$ref does not resolve: ${ref}`);
    }
    node = node[key];
  }
  return node;
}

function check(value, schema, root, at, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${at}: schema forbids any value`);
    return;
  }

  if (schema.$ref) {
    check(value, resolveRef(schema.$ref, root), root, at, errors);
    // 2020-12 allows siblings of $ref; the pinned schema uses none, but check them.
  }

  if (schema.type !== undefined) {
    const wanted = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = wanted.some((t) => TYPE_CHECKS[t]?.(value));
    if (!ok) {
      errors.push(
        `${at}: expected type ${wanted.join(' or ')}, got ${describe(value)}`,
      );
      return; // Further checks would only produce noise from the wrong shape.
    }
  }

  if (schema.const !== undefined && !same(value, schema.const)) {
    errors.push(`${at}: expected the constant ${JSON.stringify(schema.const)}, got ${describe(value)}`);
  }

  if (schema.enum !== undefined && !schema.enum.some((option) => same(value, option))) {
    errors.push(`${at}: expected one of ${JSON.stringify(schema.enum)}, got ${describe(value)}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: ${value} is below the minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: ${value} is above the maximum ${schema.maximum}`);
    }
    if (schema.multipleOf !== undefined && value % schema.multipleOf !== 0) {
      errors.push(`${at}: ${value} is not a multiple of ${schema.multipleOf}`);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i += 1) {
        for (let j = i + 1; j < value.length; j += 1) {
          if (same(value[i], value[j])) {
            errors.push(`${at}: items ${i} and ${j} are duplicates and the schema requires unique items`);
          }
        }
      }
    }
    if (schema.items !== undefined) {
      value.forEach((item, i) => check(item, schema.items, root, `${at}/${i}`, errors));
    }
  }

  if (TYPE_CHECKS.object(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) {
        errors.push(`${at}: missing required property ${JSON.stringify(key)}`);
      }
    }
    const props = schema.properties || {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) {
        check(value[key], sub, root, `${at}/${pointer(key)}`, errors);
      }
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(value)) {
        if (key in props) continue;
        if (schema.additionalProperties === false) {
          errors.push(`${at}: unexpected property ${JSON.stringify(key)}`);
        } else {
          check(value[key], schema.additionalProperties, root, `${at}/${pointer(key)}`, errors);
        }
      }
    }
    if (schema.propertyNames !== undefined) {
      for (const key of Object.keys(value)) {
        check(key, schema.propertyNames, root, `${at}/${pointer(key)} (property name)`, errors);
      }
    }
  }

  for (const branch of schema.allOf || []) {
    check(value, branch, root, at, errors);
  }

  if (schema.anyOf) {
    const branchErrors = schema.anyOf.map((branch) => {
      const collected = [];
      check(value, branch, root, at, collected);
      return collected;
    });
    if (branchErrors.every((collected) => collected.length > 0)) {
      // Report the branch that got furthest, which is the informative one.
      const best = branchErrors.reduce((a, b) => (b.length < a.length ? b : a));
      errors.push(`${at}: matched none of the ${schema.anyOf.length} allowed shapes`, ...best);
    }
  }
}

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  const t = typeof value;
  return t === 'object' ? 'an object' : `${t} ${JSON.stringify(value)}`;
}

/**
 * Validate `value` against a named definition in the pinned schema.
 *
 * Returns the list of problems, empty when the value conforms. An empty list is
 * a real result and not a proxy for "nothing looked at it":
 * `unsupportedKeywords` proves the pinned schema uses nothing this validator
 * ignores.
 */
export function validate(schema, value, defName) {
  if (defName === undefined) return [];
  const def = schema.$defs?.[defName];
  if (!def) throw new Error(`no definition named ${JSON.stringify(defName)} in the pinned schema`);
  const errors = [];
  check(value, def, schema, `#/${defName}`, errors);
  return errors;
}

/**
 * Validate `value` against an inline object schema, such as a tool's declared
 * `outputSchema`.
 *
 * The pinned schema has no definition for a JSON object as a value, because the
 * specification deliberately types `structuredContent` as any JSON value and
 * leaves the tool's own `outputSchema` to do that job. This is the entry point for
 * that job, so a tool declaring a schema it does not honour is caught here.
 */
export function validateAgainstObjectSchema(schema, value, objectSchema, label = 'schema') {
  const errors = [];
  check(value, objectSchema, schema, `#/${label}`, errors);
  return errors;
}

/**
 * Validate one JSON-RPC message against the envelope, then its result against the
 * method-specific definition.
 *
 * The envelope alone is not enough. `JSONRPCResultResponse.result` is typed as
 * `Result`, which requires only `resultType` and allows anything else, so a
 * malformed tool result passes the envelope. The method-specific definition is
 * what actually constrains the payload.
 */
export function validateMessage(schema, message, method) {
  const isError = 'error' in message && message.error !== undefined;
  const problems = isError
    ? validate(schema, message, 'JSONRPCErrorResponse')
    : validate(schema, message, 'JSONRPCResultResponse');

  if (isError) return problems;

  const perMethod = {
    'server/discover': 'DiscoverResult',
    'tools/list': 'ListToolsResult',
    'tools/call': 'CallToolResult',
    // 2026-07-28 removed `initialize` from the wire, so the schema defines no
    // InitializeResult. The legacy handshake is still answered, and `Result` is
    // all the schema can say about it.
    initialize: 'Result',
    ping: 'Result',
  };
  const defName = perMethod[method];
  if (!defName) return problems;
  return problems.concat(validate(schema, message.result, defName));
}

/**
 * Every keyword the reachable part of the schema uses, that this validator does
 * not implement.
 *
 * Walks from the definitions this endpoint's methods can return, so an unused
 * extension cannot demand a validator feature.
 *
 * The scan looks at the keys of each schema *node* object. It must not report the
 * property names inside `properties`, which are instance keys, not keywords: a
 * schema whose `properties` map contains `cacheScope` does not use a `cacheScope`
 * keyword. So it descends only into keyword positions, and records the instance
 * keys it steps over so it never treats one as a keyword later.
 *
 * An empty result means the schema uses nothing this validator ignores, which is
 * what makes a passing validation mean something. A keyword that appears where it
 * is not implemented is returned, so the test fails loudly instead of the
 * validator quietly under-checking.
 */
export function unsupportedKeywords(schema, entryPoints) {
  const defs = schema.$defs || {};
  const seen = new Set();
  const stack = [...entryPoints].filter((name) => name in defs);
  const unsupported = new Set();

  // Positions whose values are schemas to descend into, or arrays of them.
  const SCHEMA_VALUES = new Set([
    'items', 'additionalProperties', 'propertyNames', 'contains',
    'not', 'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties',
  ]);
  const SCHEMA_LISTS = new Set([
    'anyOf', 'allOf', 'oneOf', 'prefixItems',
  ]);

  const note = (keyword) => {
    if (UNSUPPORTED.has(keyword) || (!ANNOTATIONS.has(keyword) && !SUPPORTED.has(keyword))) {
      unsupported.add(keyword);
    }
  };

  const scan = (node) => {
    if (Array.isArray(node)) {
      node.forEach(scan);
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const [keyword, value] of Object.entries(node)) {
      note(keyword);

      if (keyword === '$ref') {
        if (typeof value !== 'string' || !value.startsWith('#/$defs/')) {
          unsupported.add('$ref:non-local');
        } else {
          const name = value.replace('#/$defs/', '');
          if (!seen.has(name) && name in defs) {
            seen.add(name);
            stack.push(name);
          }
        }
        continue;
      }

      if (SCHEMA_LISTS.has(keyword)) {
        (value || []).forEach(scan);
        continue;
      }
      if (SCHEMA_VALUES.has(keyword)) {
        scan(value);
        continue;
      }
      if (keyword === 'properties' || keyword === '$defs' || keyword === 'dependentSchemas' || keyword === 'patternProperties') {
        // A map of name to schema. Step over the names without judging them.
        for (const sub of Object.values(value || {})) scan(sub);
        continue;
      }
      // Anything else is a plain value: an enum, a const, a type list, a default.
      // Not descended into.
    }
  };

  for (const name of entryPoints) if (name in defs) seen.add(name);
  while (stack.length > 0) scan(defs[stack.pop()]);
  return [...unsupported].sort();
}

/**
 * The definitions the endpoint's own methods can produce.
 *
 * There is no `InitializeResult` here because 2026-07-28 removed `initialize`
 * from the wire, and the pinned schema has no such definition. The endpoint still
 * answers the handshake for 2025-era clients, so that reply is validated against
 * `Result`, which is the weakest definition the schema offers: `resultType` plus
 * anything. That is a real limit, and it is the honest one to record — the modern
 * schema cannot constrain a legacy message.
 */
export const WIRE_ENTRY_POINTS = [
  'JSONRPCResultResponse',
  'JSONRPCErrorResponse',
  'DiscoverResult',
  'ListToolsResult',
  'CallToolResult',
  'Result',
];

/** The pinned schema, loaded once per process. */
export async function loadSchema() {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(import.meta.dirname, 'fixtures', 'mcp-schema-2026-07-28.json');
  return JSON.parse(await readFile(file, 'utf8'));
}