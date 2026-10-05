import { createContext } from 'react';
import type { ConsentConfig } from './consentConfig';
import type { ConsentChoice, StoredConsentDecision } from './storage';

export type ConsentContextValue = {
  config: ConsentConfig;
  decision: StoredConsentDecision | null;
  loading: boolean;
  requiresPrompt: boolean;
  hasRequiredConsent: boolean;
  allowsPersistentIdentity: boolean;
  setConsentChoice: (choice: ConsentChoice) => Promise<void>;
};

export const ConsentContext = createContext<ConsentContextValue | undefined>(undefined);
