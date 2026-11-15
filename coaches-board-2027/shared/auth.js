// Shared admin-passcode check for every CLFC Worker.
// Import this instead of writing a local copy, so the rules live in one place.
//
// Returns one of:
//   'not-set' - the ADMIN_PASSCODE secret is missing. Callers must refuse access
//               (the check never falls through to 'ok' when the secret is absent).
//   'ok'      - the supplied value matches the secret.
//   'wrong'   - anything else, including a missing or non-string value.

export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passcodeState(supplied, env) {
  const expected = env && env.ADMIN_PASSCODE;
  if (!expected) return 'not-set';
  const value = typeof supplied === 'string' ? supplied : '';
  return constantTimeEqual(value, expected) ? 'ok' : 'wrong';
}
