"use strict";

// A renderer document may handle many SPA chat scopes, but it must never
// silently switch the verified owner/origin. Loading authorizes a scope;
// saving/clearing an arbitrary unhydrated scope is not permitted.
function createDraftSessionGate() {
  let documentVersion = 0;
  let bound = null;
  const loadedScopes = new Set();
  return {
    documentVersion: () => documentVersion,
    reset() {
      documentVersion++;
      bound = null;
      loadedScopes.clear();
    },
    bindLoad(version, origin, owner, scope) {
      if (version !== documentVersion || !origin || !owner || typeof scope !== "string")
        return false;
      if (bound && (bound.origin !== origin || bound.owner !== owner)) return false;
      if (!bound) bound = { origin, owner };
      loadedScopes.add(scope);
      return true;
    },
    ownerForFlush(version, origin, scope) {
      return version === documentVersion && bound?.origin === origin && loadedScopes.has(scope)
        ? bound.owner
        : null;
    },
    allowWrite(version, origin, owner, scope) {
      return (
        version === documentVersion &&
        bound?.origin === origin &&
        bound.owner === owner &&
        loadedScopes.has(scope)
      );
    }
  };
}

module.exports = { createDraftSessionGate };
