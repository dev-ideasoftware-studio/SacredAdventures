/**
 * Sacred Adventures v2 — lightweight runtime service registry.
 *
 * Modules use this for live cross-module state instead of reaching directly for
 * window.* globals. Legacy globals can stay as aliases while the V2 modules move
 * toward an explicit runtime contract.
 */

/**
 * Runtime service contracts.
 *
 * Two flavours of contract:
 *   • Required ({ requiredWhenActive }) — when the named module is active,
 *     the service MUST be registered or validate fails.
 *   • Optional ({ optional: true })   — never required to be registered;
 *     when registered, its shape (`methods`) is verified.
 *
 * `methods` map is `{ [methodName]: { kind: "function", arity?: number } }`.
 * `arity` is the declared parameter count (Function.length); omit when
 * variadic or when the count is not part of the contract.
 */
export const RUNTIME_SERVICE_CONTRACTS = Object.freeze({
  WorldPhysics: Object.freeze({
    owner: "World",
    requiredWhenActive: "World",
    description: "Terrain/elevation physics, colliders, and body integration.",
  }),
  WorldPlayer: Object.freeze({
    owner: "World",
    requiredWhenActive: "World",
    description: "Live governed player pose, avatar, yaw, movement, and distance state.",
  }),
  PipOrthoBranchClip: Object.freeze({
    owner: "PipOrthoRingDiskClip",
    optional: true,
    description:
      "PiP ortho ring/disk clip — discards forest fragments under the moondial bezel so the compass reads cleanly.",
    methods: Object.freeze({
      armOrthoClip: Object.freeze({ kind: "function", arity: 2 }),
      clearOrthoClip: Object.freeze({ kind: "function", arity: 0 }),
    }),
  }),
});

const _services = new Map();
const _metadata = new Map();

export function registerRuntimeService(name, value, options = {}) {
  if (!name || typeof name !== "string") {
    throw new TypeError("Runtime service name must be a non-empty string.");
  }
  const contract = RUNTIME_SERVICE_CONTRACTS[name] ?? null;
  const owner = options.owner ?? contract?.owner ?? "unknown";
  _services.set(name, value);
  _metadata.set(name, Object.freeze({
    name,
    owner,
    contract,
    registeredAt: new Date().toISOString(),
  }));
  return value;
}

export function getRuntimeService(name) {
  return _services.get(name) ?? null;
}

export function clearRuntimeService(name, expectedValue) {
  if (!_services.has(name)) return;
  if (arguments.length > 1 && _services.get(name) !== expectedValue) return;
  _services.delete(name);
  _metadata.delete(name);
}

export function clearRuntimeServicesForOwner(owner) {
  for (const [name, meta] of [..._metadata.entries()]) {
    if (meta.owner === owner) clearRuntimeService(name);
  }
}

export function getRuntimeServicesSnapshot() {
  const services = [..._metadata.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((meta) => Object.freeze({
      name: meta.name,
      owner: meta.owner,
      contractOwner: meta.contract?.owner ?? null,
      requiredWhenActive: meta.contract?.requiredWhenActive ?? null,
      registeredAt: meta.registeredAt,
    }));
  return Object.freeze({
    names: Object.freeze([..._services.keys()].sort()),
    services: Object.freeze(services),
    contracts: RUNTIME_SERVICE_CONTRACTS,
  });
}

/**
 * Validate every contracted service against the live registry.
 *
 * @param {string[]} activeModules - Names of currently active orchestrator modules.
 * @returns {Readonly<{
 *   ok: boolean,
 *   missing: ReadonlyArray<{ name: string, owner: string, requiredWhenActive: string }>,
 *   malformed: ReadonlyArray<{ name: string, reason: string, methods?: string[] }>,
 *   snapshot: ReturnType<typeof getRuntimeServicesSnapshot>,
 * }>}
 */
export function validateRuntimeServiceContracts(activeModules = []) {
  const active = new Set(activeModules);
  const missing = [];
  const malformed = [];

  for (const [name, contract] of Object.entries(RUNTIME_SERVICE_CONTRACTS)) {
    const isOptional = contract.optional === true;
    const isPresent = _services.has(name);

    // Required+absent → missing
    if (
      !isOptional &&
      contract.requiredWhenActive &&
      active.has(contract.requiredWhenActive) &&
      !isPresent
    ) {
      missing.push({
        name,
        owner: contract.owner,
        requiredWhenActive: contract.requiredWhenActive,
      });
      continue;
    }

    // Present (required or optional) with a methods contract → verify shape
    if (isPresent && contract.methods) {
      const value = _services.get(name);
      const issues = [];
      if (value == null || (typeof value !== "object" && typeof value !== "function")) {
        malformed.push({ name, reason: `service value is not an object/function (got ${typeof value})` });
        continue;
      }
      for (const [method, spec] of Object.entries(contract.methods)) {
        const fn = value[method];
        if (spec.kind === "function") {
          if (typeof fn !== "function") {
            issues.push(`${method}: missing or non-function (got ${typeof fn})`);
            continue;
          }
          if (typeof spec.arity === "number" && fn.length !== spec.arity) {
            issues.push(`${method}: declared arity ${spec.arity}, got ${fn.length}`);
          }
        }
      }
      if (issues.length > 0) {
        malformed.push({ name, reason: "method-shape", methods: issues });
      }
    }
  }

  return Object.freeze({
    ok: missing.length === 0 && malformed.length === 0,
    missing: Object.freeze(missing),
    malformed: Object.freeze(malformed),
    snapshot: getRuntimeServicesSnapshot(),
  });
}
