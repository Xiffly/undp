export type ConsentChoice = 'accept_all' | 'necessary_only' | 'decline';

export type StoredConsentDecision = {
  choice: ConsentChoice;
  version: string;
  updatedAt: string;
};

const CONSENT_STORAGE_KEY = 'undp_privacy_consent';
const PUBLIC_ACTOR_KEY = 'public_actor_key';

export function readStoredConsent(): StoredConsentDecision | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredConsentDecision;
    if (!parsed?.choice || !parsed?.version) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredConsent(choice: ConsentChoice, version: string) {
  const decision: StoredConsentDecision = {
    choice,
    version,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(decision));
  return decision;
}

export function clearStoredConsent() {
  localStorage.removeItem(CONSENT_STORAGE_KEY);
}

export async function clearConsentScopedClientState() {
  localStorage.removeItem(PUBLIC_ACTOR_KEY);
}
