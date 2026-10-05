import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { type ConsentConfig, DEFAULT_CONSENT_CONFIG } from './consentConfig';
import { ConsentContext, type ConsentContextValue } from './ConsentContextTypes';
import {
  clearConsentScopedClientState,
  type ConsentChoice,
  readStoredConsent,
  type StoredConsentDecision,
  writeStoredConsent,
} from './storage';

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<ConsentConfig>(DEFAULT_CONSENT_CONFIG);
  const [decision, setDecision] = useState<StoredConsentDecision | null>(() => readStoredConsent());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadConfig = async () => {
      try {
        const nextConfig = await api.getConsentConfig();
        if (!cancelled) {
          setConfig(nextConfig);
        }
      } catch {
        if (!cancelled) {
          setConfig(DEFAULT_CONSENT_CONFIG);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadConfig().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setConsentChoice = useCallback(async (choice: ConsentChoice) => {
    const nextVersion = config.consent_version || DEFAULT_CONSENT_CONFIG.consent_version;
    const nextDecision = writeStoredConsent(choice, nextVersion);
    setDecision(nextDecision);

    if (choice === 'decline') {
      await clearConsentScopedClientState();
    }
  }, [config.consent_version]);

  const hasRequiredConsent = useMemo(() => {
    if (!config.banner_enabled) return true;
    if (!decision) return false;
    return decision.version === config.consent_version;
  }, [config.banner_enabled, config.consent_version, decision]);

  const allowsPersistentIdentity = useMemo(() => {
    if (!config.banner_enabled) return true;
    if (!decision || decision.version !== config.consent_version) return false;
    return decision.choice !== 'decline';
  }, [config.banner_enabled, config.consent_version, decision]);

  const requiresPrompt = useMemo(() => {
    if (!config.banner_enabled) return false;
    if (!decision) return true;
    return decision.version !== config.consent_version;
  }, [config.banner_enabled, config.consent_version, decision]);

  const value = useMemo<ConsentContextValue>(() => ({
    config,
    decision,
    loading,
    requiresPrompt,
    hasRequiredConsent,
    allowsPersistentIdentity,
    setConsentChoice,
  }), [config, decision, loading, requiresPrompt, hasRequiredConsent, allowsPersistentIdentity, setConsentChoice]);

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}
