import express, { Request, Response } from 'express';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  getContributorDetail,
  getContributorList,
  grantManualBadge,
  recomputeAllContributorProfiles,
  revokeManualBadge,
} from '../services/contributorReputation';
import {
  getContributorReputationSettings,
  resetContributorReputationSettings,
  updateContributorReputationSettings,
} from '../services/contributorReputationSettings';

const router = express.Router();

router.get('/', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const offset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0);
  const minTrust = req.query.min_trust !== undefined ? Number(req.query.min_trust) : undefined;
  const minPoints = req.query.min_points !== undefined ? Number(req.query.min_points) : undefined;
  const result = await getContributorList({
    search: String(req.query.search || '').trim() || undefined,
    badge: String(req.query.badge || '').trim() || undefined,
    level: String(req.query.level || '').trim() || undefined,
    minTrust: Number.isFinite(minTrust) ? minTrust : undefined,
    minPoints: Number.isFinite(minPoints) ? minPoints : undefined,
    limit,
    offset,
  });
  res.json({ ...result, limit, offset });
});

router.post('/recompute-all', authMiddleware, requireRole('admin'), async (_req: Request, res: Response): Promise<void> => {
  const recomputed = await recomputeAllContributorProfiles();
  res.json({ success: true, recomputed });
});

router.get('/settings', authMiddleware, requireRole('admin'), async (_req: Request, res: Response): Promise<void> => {
  res.json({ settings: await getContributorReputationSettings() });
});

router.patch('/settings', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  if (req.body?.reset === true) {
    res.json({ success: true, settings: await resetContributorReputationSettings() });
    return;
  }
  res.json({ success: true, settings: await updateContributorReputationSettings(req.body || {}) });
});

router.get('/:key', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const detail = await getContributorDetail(req.params.key);
  if (!detail) {
    res.status(404).json({ error: 'Contributor not found' });
    return;
  }
  res.json(detail);
});

router.post('/:key/manual-awards', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const badgeCode = String(req.body?.badge_code || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (badgeCode !== 'community_hero') {
    res.status(400).json({ error: 'Only community_hero can be manually awarded' });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: 'Reason is required' });
    return;
  }
  await grantManualBadge(req.params.key, badgeCode, String(req.body?.awarded_by || 'admin'), reason);
  res.json({ success: true });
});

router.delete('/:key/manual-awards/:badgeCode', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  if (req.params.badgeCode !== 'community_hero') {
    res.status(400).json({ error: 'Only community_hero can be manually revoked' });
    return;
  }
  await revokeManualBadge(req.params.key, req.params.badgeCode);
  res.json({ success: true });
});

export default router;
