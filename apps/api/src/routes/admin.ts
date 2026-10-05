import express, { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createAdminSession, revokeAdminSession, isTrustedSessionRequest, ADMIN_SESSION_SECONDS } from '../services/adminSessions';
import { queryAll, queryOne, execute } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';
import { Report } from '../types';
import { repairStoredPhotoValue, resolveReportMedia } from '../reportMedia';
import { formatReport, resolveTranslationsForMany } from './reports';
import { applyResolvedAccuracyScore, recomputeContributorProfile } from '../services/contributorReputation';
import { inspectTextCorruption } from '../utils/textCorruption';
import {
  getModerationSettings,
  getModerationSettingsPayload,
  setModerationSettings,
} from '../services/moderationSettings';
import {
  adminVerifyPhone,
  listIdentityConflicts,
  manualLinkUserToContributor,
  mergeContributorProfiles,
} from '../services/identityLinking';

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || '';

function generateToken(user: { id: string; email: string; role: string; name?: string | null }): string {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name || undefined, isAdmin: user.role === 'admin' },
    JWT_SECRET,
    { expiresIn: '30m', algorithm: 'HS256' }
  );
}

function safeJsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return [];
    if (t.startsWith('[')) {
      try { return JSON.parse(t); } catch { return []; }
    }
    return [t];
  }
  return [];
}

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, max);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sanitizeAddressPreview(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text.slice(0, 240) : null;
}

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isTrustedSessionRequest(req)) { res.status(403).json({ error: 'Untrusted request origin' }); return; }
  if (!JWT_SECRET) {
    res.status(500).json({ error: 'Authentication is not configured' });
    return;
  }

  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email) { res.status(400).json({ error: 'Email is required' }); return; }
  if (!password) { res.status(400).json({ error: 'Password is required' }); return; }

  const user = await queryOne<any>('SELECT id, name, email, password_hash, role, active FROM users WHERE email = ?', [email]);
  if (!user || !user.active || user.role !== 'admin') {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  await execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  await createAdminSession(req, res, user.id);
  // Temporary compatibility for local integration tests; production never exposes an admin token.
  const token = process.env.NODE_ENV === 'production' ? undefined : generateToken(user);
  res.json({ token, expiresIn: ADMIN_SESSION_SECONDS });
});

router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  if (!isTrustedSessionRequest(req)) { res.status(403).json({ error: 'Untrusted request origin' }); return; }
  await revokeAdminSession(req, res);
  res.status(204).end();
});

router.get('/session', authMiddleware, requireRole('field_officer'), (_req: Request, res: Response): void => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ authenticated: true });
});

router.get('/stats', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const total = (await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM reports'))?.c || 0;
  const pending = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'"))?.c || 0;
  const verified = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status = 'verified'"))?.c || 0;
  const flagged = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status = 'flagged'"))?.c || 0;
  const duplicate = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status = 'duplicate'"))?.c || 0;
  const rejected = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE status = 'rejected'"))?.c || 0;
  const destroyed = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE damage_level = 'destroyed'"))?.c || 0;
  const partial = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE damage_level = 'partial'"))?.c || 0;
  const minimal = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE damage_level = 'minimal'"))?.c || 0;
  const last24h = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE submitted_at >= datetime('now', '-1 day')"))?.c || 0;
  const lastHour = (await queryOne<{ c: number }>("SELECT COUNT(*) as c FROM reports WHERE submitted_at >= datetime('now', '-1 hour')"))?.c || 0;

  
  const allReports = await queryAll<{ infra_types: string }>('SELECT infra_types FROM reports');
  const byType: Record<string, number> = {};
  allReports.forEach((r) => {
    const types = safeJsonArray(r.infra_types) as string[];
    types.forEach((t) => { byType[t] = (byType[t] || 0) + 1; });
  });

  
  const trend = await queryAll<{ hour: string; count: number }>(`
    SELECT strftime('%H', submitted_at) as hour, COUNT(*) as count
    FROM reports
    WHERE submitted_at >= datetime('now', '-24 hours')
    GROUP BY hour ORDER BY hour
  `);

  
  const byChannel = await queryAll<{ channel: string; count: number }>(`
    SELECT channel, COUNT(*) as count FROM reports GROUP BY channel
  `);

  const contributorSummary = await queryAll<{ badge: string; count: number }>(`
    SELECT primary_badge as badge, COUNT(*)::int as count
    FROM contributor_profiles
    WHERE primary_badge IS NOT NULL AND primary_badge <> 'none'
    GROUP BY primary_badge
  `);

  res.json({
    total, pending, verified, flagged, duplicate, rejected, destroyed, partial, minimal,
    last_24h: last24h, last_hour: lastHour,
    by_type: byType, trend, by_channel: byChannel,
    contributor_badges: contributorSummary,
  });
});

router.get('/reports', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { status, damage_level, since, limit = '50', offset = '0', search, target_lang = 'en' } = req.query;
  const safeLimit = parsePositiveInt(limit, 50, 500);
  const safeOffset = parsePositiveInt(offset, 0, 100000);
  let query = 'SELECT * FROM reports WHERE 1=1';
  const params: (string | number)[] = [];

  if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
  if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
  if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
  if (search) {
    query += ' AND (id LIKE ? OR description LIKE ? OR address_text LIKE ? OR building_label LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const countBase = query.replace('SELECT *', 'SELECT COUNT(*) as c');
  const totalResult = await queryOne<{ c: number }>(countBase, params) as { c: number };
  const total = totalResult.c;

  query += ' ORDER BY submitted_at DESC LIMIT ? OFFSET ?';
  params.push(safeLimit, safeOffset);

  const rows = await queryAll<Report>(query, params);
  const formatted = await Promise.all(rows.map((r) => formatReport(r)));

  res.json({
    reports: await resolveTranslationsForMany(formatted, String(target_lang || 'en').toLowerCase(), { queueMissing: false }),
    total,
    limit: safeLimit,
    offset: safeOffset,
  });
});

router.get('/reports/stats', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { status, damage_level, since, search } = req.query;
  let query = 'FROM reports WHERE 1=1';
  const params: (string | number)[] = [];

  if (status && status !== 'all') { query += ' AND status = ?'; params.push(status as string); }
  if (damage_level && damage_level !== 'all') { query += ' AND damage_level = ?'; params.push(damage_level as string); }
  if (since) { query += ' AND submitted_at >= ?'; params.push(since as string); }
  if (search) {
    query += ' AND (id LIKE ? OR description LIKE ? OR address_text LIKE ? OR building_label LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const stats = await queryOne<{
    total: number;
    destroyed: number;
    partial: number;
    minimal: number;
    urgent: number;
    pending: number;
    verified: number;
    flagged: number;
    duplicate: number;
    rejected: number;
  }>(`
    SELECT
      COUNT(*)::int AS total,
      COALESCE(SUM(CASE WHEN damage_level = 'destroyed' THEN 1 ELSE 0 END), 0)::int AS destroyed,
      COALESCE(SUM(CASE WHEN damage_level = 'partial' THEN 1 ELSE 0 END), 0)::int AS partial,
      COALESCE(SUM(CASE WHEN damage_level = 'minimal' THEN 1 ELSE 0 END), 0)::int AS minimal,
      COALESCE(SUM(CASE WHEN CAST(is_urgent AS text) IN ('1', 'true', 't') THEN 1 ELSE 0 END), 0)::int AS urgent,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0)::int AS pending,
      COALESCE(SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END), 0)::int AS verified,
      COALESCE(SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END), 0)::int AS flagged,
      COALESCE(SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END), 0)::int AS duplicate,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0)::int AS rejected
    ${query}
  `, params);

  res.json(stats || {
    total: 0,
    destroyed: 0,
    partial: 0,
    minimal: 0,
    urgent: 0,
    pending: 0,
    verified: 0,
    flagged: 0,
    duplicate: 0,
    rejected: 0,
  });
});

router.patch('/reports/bulk', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { ids, status } = req.body;
  const allowed = ['pending', 'verified', 'flagged', 'duplicate', 'rejected'];
  if (!allowed.includes(status) || !Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Invalid request' }); return;
  }
  const placeholders = ids.map(() => '?').join(',');
  const params = status === 'verified'
    ? [status, new Date().toISOString(), ...ids]
    : [status, ...ids];
  const setClause = status === 'verified'
    ? 'status = ?, verified_at = ?'
    : 'status = ?';
  const before = await queryAll<{ id: string; contributor_key?: string | null }>(`SELECT id, contributor_key FROM reports WHERE id IN (${placeholders})`, ids);
  await execute(`UPDATE reports SET ${setClause} WHERE id IN (${placeholders})`, params);
  if (status === 'verified' || status === 'duplicate' || status === 'rejected') {
    for (const row of before) {
      await applyResolvedAccuracyScore(row.id, status, 'admin');
    }
  }
  const contributorKeys = Array.from(new Set(before.map((row) => row.contributor_key).filter(Boolean))) as string[];
  for (const contributorKey of contributorKeys) {
    await recomputeContributorProfile(contributorKey);
  }
  res.json({ success: true, updated: ids.length });
});

router.get('/report-settings', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const settings = await getModerationSettingsPayload();
  res.json({ settings });
});

router.patch('/report-settings', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const updated = await setModerationSettings(
    Object.fromEntries(Object.entries(req.body || {}).map(([key, value]) => [key, String(value)]))
  );
  res.json({ success: true, updated });
});

router.post('/report-settings/detect-duplicates', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  try {
    const moderationSettings = await getModerationSettings();
    if (!moderationSettings.duplicateDetectionEnabled) {
      res.status(403).json({ error: 'Duplicate detection feature is disabled' });
      return;
    }

    const radiusM = parseFloat(String(req.body.radius_m || moderationSettings.duplicateRadiusM));
    const timeHours = parseFloat(String(req.body.time_hours || moderationSettings.duplicateTimeHours));
    const since = new Date(Date.now() - timeHours * 60 * 60 * 1000).toISOString();
    const reports = await queryAll<any>(
      "SELECT id, lat, lng, damage_level, infra_category, submitted_at, status FROM reports WHERE submitted_at >= ? AND status != 'duplicate' ORDER BY submitted_at DESC",
      [since]
    );

    const duplicateGroups: { primary: string; duplicates: string[]; distance_m: number }[] = [];
    const processed = new Set<string>();

    for (let index = 0; index < reports.length; index++) {
      if (processed.has(reports[index].id)) continue;
      const group: string[] = [];
      for (let nested = index + 1; nested < reports.length; nested++) {
        if (processed.has(reports[nested].id)) continue;
        const distance = haversineM(reports[index].lat, reports[index].lng, reports[nested].lat, reports[nested].lng);
        if (distance <= radiusM) {
          group.push(reports[nested].id);
          processed.add(reports[nested].id);
        }
      }
      if (group.length > 0) {
        duplicateGroups.push({ primary: reports[index].id, duplicates: group, distance_m: radiusM });
        processed.add(reports[index].id);
      }
    }

    const autoFlag = req.body.auto_flag === true || req.body.auto_flag === 'true';
    let flagged = 0;
    if (autoFlag) {
      for (const group of duplicateGroups) {
        for (const duplicateId of group.duplicates) {
          await execute(
            "UPDATE reports SET status = 'duplicate', internal_notes = ? WHERE id = ?",
            [`[Moderation] Auto-flagged as likely duplicate of ${group.primary} (within ${radiusM}m)`, duplicateId]
          );
          flagged += 1;
        }
      }
    }

    res.json({
      success: true,
      duplicate_groups: duplicateGroups,
      total_duplicates: duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0),
      radius_m: radiusM,
      time_hours: timeHours,
      reports_scanned: reports.length,
      auto_flagged: flagged,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Duplicate detection failed' });
  }
});

router.post('/reports/reverse-geocode', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    res.status(400).json({ error: 'Valid coordinates are required' });
    return;
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': String(req.headers['accept-language'] || 'en'),
        'User-Agent': 'UNDP-Crisis-Admin/1.0',
      },
    });

    if (!response.ok) {
      res.status(502).json({ error: 'Reverse geocoding lookup failed' });
      return;
    }

    const data = await response.json() as {
      display_name?: string;
      lat?: string;
      lon?: string;
      address?: Record<string, string>;
    };

    res.json({
      success: true,
      address_text: sanitizeAddressPreview(data.display_name),
      provider: 'nominatim',
      resolved_lat: data.lat ? Number(data.lat) : lat,
      resolved_lng: data.lon ? Number(data.lon) : lng,
      address: data.address || {},
    });
  } catch {
    res.status(502).json({ error: 'Reverse geocoding lookup failed' });
  }
});

router.get('/reports/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const targetLang = String(req.query.target_lang || 'en').toLowerCase();
  const row = await queryOne<Report>('SELECT * FROM reports WHERE id = ?', [req.params.id]);
  if (!row) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const formatted = await formatReport(row);
  const [resolved] = await resolveTranslationsForMany([formatted], targetLang, { retryFailed: true });
  res.json(resolved);
});

router.get('/identity-links', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const conflicts = await listIdentityConflicts();
  res.json({ conflicts, total: conflicts.length });
});

router.post('/identity-links/:userId/link', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const contributorKey = String(req.body?.contributor_key || '').trim();
    if (!contributorKey) { res.status(400).json({ error: 'contributor_key is required' }); return; }
    await manualLinkUserToContributor(req.params.userId, contributorKey, 'admin', String(req.body?.reason || 'Manual identity link'));
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to link user' });
  }
});

router.post('/contributors/:key/merge', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const sourceContributorKey = String(req.body?.source_contributor_key || '').trim();
    if (!sourceContributorKey) { res.status(400).json({ error: 'source_contributor_key is required' }); return; }
    await mergeContributorProfiles({
      targetContributorKey: req.params.key,
      sourceContributorKey,
      mergedBy: 'admin',
      reason: String(req.body?.reason || 'Admin merge'),
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to merge contributor' });
  }
});

router.post('/users/:id/phone-verification', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await adminVerifyPhone(req.params.id, req.body?.phone, 'admin', String(req.body?.reason || 'Admin phone verification'));
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to verify phone' });
  }
});

router.post('/media/repair', authMiddleware, requireRole('admin'), async (_req: Request, res: Response): Promise<void> => {
  const reports = await queryAll<{ id: string; photos: unknown }>('SELECT id, photos FROM reports');
  let normalized = 0;
  let aiFailedNormalized = 0;
  let unresolved = 0;

  for (const report of reports) {
    const repaired = repairStoredPhotoValue(report.photos);
    if (repaired.changed) {
      await execute('UPDATE reports SET photos = ?::jsonb WHERE id = ?', [JSON.stringify(repaired.next_keys), report.id]);
      normalized += 1;
    }
    const media = await resolveReportMedia(repaired.next_keys);
    if (media.ai_media_eligibility !== 'eligible') {
      await execute(
        "UPDATE ai_classify_jobs SET status = 'failed_terminal', last_error_code = ?, last_error_message = ?, next_attempt_at = NULL, locked_at = NULL, updated_at = NOW() WHERE report_id = ? AND status IN ('pending', 'retry_wait', 'processing')",
        [
          media.ai_media_eligibility,
          media.ai_media_eligibility === 'no_photos'
            ? 'No photos found for this report'
            : media.ai_media_eligibility === 'missing_media'
              ? 'Photo files are missing for this report'
              : 'Photo references are invalid for this report',
          report.id,
        ]
      );
      await execute(
        "UPDATE reports SET ai_classification_status = 'failed', ai_classification_error = ? WHERE id = ? AND ai_classification_status = 'pending'",
        [
          media.ai_media_eligibility === 'no_photos'
            ? 'No photos found for this report'
            : media.ai_media_eligibility === 'missing_media'
              ? 'Photo files are missing for this report'
              : 'Photo references are invalid for this report',
          report.id,
        ]
      );
      aiFailedNormalized += 1;
    }
    if (media.media_state !== 'none' && media.media_state !== 'ready') {
      unresolved += 1;
    }
  }

  res.json({
    success: true,
    reports_scanned: reports.length,
    normalized,
    ai_failed_normalized: aiFailedNormalized,
    unresolved,
  });
});

router.get('/translation-audit', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const reportRows = await queryAll<{
    id: string;
    building_label?: string | null;
    address_text?: string | null;
    infra_name?: string | null;
    description?: string | null;
  }>('SELECT id, building_label, address_text, infra_name, description FROM reports ORDER BY submitted_at DESC LIMIT 5000');
  const translationRows = await queryAll<{
    report_id: string;
    target_lang: string;
    field_name: string;
    translated_text?: string | null;
  }>('SELECT report_id, target_lang, field_name, translated_text FROM report_translations ORDER BY updated_at DESC LIMIT 10000');

  const reportIssues = reportRows.flatMap((row) => ([
    ['building_label', row.building_label],
    ['address_text', row.address_text],
    ['infra_name', row.infra_name],
    ['description', row.description],
  ] as const).flatMap(([field, value]) => {
    const issues = inspectTextCorruption(value);
    if (!issues.length) return [];
    return [{
      scope: 'report',
      report_id: row.id,
      field,
      value,
      issues,
    }];
  }));

  const translationIssues = translationRows.flatMap((row) => {
    const issues = inspectTextCorruption(row.translated_text);
    if (!issues.length) return [];
    return [{
      scope: 'report_translation',
      report_id: row.report_id,
      field: row.field_name,
      target_lang: row.target_lang,
      value: row.translated_text,
      issues,
    }];
  });

  res.json({
    report_issue_count: reportIssues.length,
    translation_issue_count: translationIssues.length,
    report_issues: reportIssues.slice(0, 200),
    translation_issues: translationIssues.slice(0, 200),
  });
});

export default router;
