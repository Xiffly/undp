import express, { Request, Response } from 'express';
import { getConsentSettings } from '../services/consentSettings';

const router = express.Router();

router.get('/config', async (_req: Request, res: Response): Promise<void> => {
  const settings = await getConsentSettings();
  res.json({
    consent_version: settings.consentVersion,
    privacy_policy_url: settings.privacyPolicyUrl,
    governance_policy_url: settings.governancePolicyUrl,
    banner_enabled: settings.bannerEnabled,
  });
});

export default router;
