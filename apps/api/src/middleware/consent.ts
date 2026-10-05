import type { Request, Response, NextFunction } from 'express';
import { getConsentSettings } from '../services/consentSettings';

export type ConsentChoice = 'accept_all' | 'necessary_only' | 'decline';

function normalizeConsentChoice(value: unknown): ConsentChoice | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'accept_all' || normalized === 'necessary_only' || normalized === 'decline') {
    return normalized;
  }
  return null;
}

export function readConsentFromRequest(req: Request) {
  return {
    choice: normalizeConsentChoice(req.header('X-Consent-Choice')),
    version: String(req.header('X-Consent-Version') || '').trim(),
  };
}

export async function requirePrivacyConsent(req: Request, res: Response, next: NextFunction): Promise<void> {
  const settings = await getConsentSettings();
  const consent = readConsentFromRequest(req);

  if (!settings.bannerEnabled) {
    next();
    return;
  }

  if (consent.choice && consent.version === settings.consentVersion) {
    next();
    return;
  }

  res.status(403).json({
    error: 'A privacy choice is required before continuing.',
    code: 'privacy_consent_required',
    consent: {
      required_version: settings.consentVersion,
      banner_enabled: settings.bannerEnabled,
    },
  });
}
