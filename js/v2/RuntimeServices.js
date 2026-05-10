/**
 * Sacred Adventures v2 — lightweight runtime service registry.
 *
 * Modules use this for live cross-module state instead of reaching directly for
 * window.* globals. Legacy globals can stay as aliases while the V2 modules move
 * toward an explicit runtime contract.
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

export function validateRuntimeServiceContracts(activeModules = []) {
  const active = new Set(activeModules);
  const missing = [];
  for (const [name, contract] of Object.entries(RUNTIME_SERVICE_CONTRACTS)) {
    if (contract.requiredWhenActive && active.has(contract.requiredWhenActive) && !_services.has(name)) {
      missing.push({ name, owner: contract.owner, requiredWhenActive: contract.requiredWhenActive });
    }
  }
  return Object.freeze({
    ok: missing.length === 0,
    missing: Object.freeze(missing),
    snapshot: getRuntimeServicesSnapshot(),
  });
}
