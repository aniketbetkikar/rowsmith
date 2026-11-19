// A tiny store that lets links outside the wizard reset it. With
// cacheComponents, Next keeps the home page's client state alive across
// navigations, so the wizard would otherwise reopen on its last step.
let token = 0;
const listeners = new Set<() => void>();

export function subscribeReset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetToken(): number {
  return token;
}

/** Bumps the token; the wizard is keyed on it, so it remounts fresh. */
export function requestWizardReset(): void {
  token += 1;
  for (const listener of listeners) listener();
}
