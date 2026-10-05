import crypto from 'crypto';
import { randomUUID as uuidv4 } from 'node:crypto';
import { execute, queryAll, queryOne } from '../dbRuntime';
import { recomputeContributorProfile } from './contributorReputation';

const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const WHATSAPP_ACTOR_SALT = process.env.WHATSAPP_ACTOR_SALT || process.env.CONTRIBUTOR_KEY_SALT || 'crisis-contributor-salt';
const CONTRIBUTOR_SALT = process.env.CONTRIBUTOR_KEY_SALT || 'crisis-contributor-salt';
const PHONE_VERIFY_TTL_MINUTES = Math.max(parseInt(process.env.PHONE_VERIFY_TTL_MINUTES || '10', 10) || 10, 1);

export type IdentityConflict = {
  id: string;
  conflict_type: string;
  phone_e164?: string | null;
  user_id?: string | null;
  contributor_key?: string | null;
  details?: string | null;
  status: string;
  created_at?: string;
};

export type IdentitySummary = {
  phone: string | null;
  verified_phone: string | null;
  pending_phone: string | null;
  phone_verified: boolean;
  linked_contributor_key: string | null;
  verification_pending: boolean;
  verification_nonce?: string | null;
  verification_expires_at?: string | null;
  contributor?: any;
  last_whatsapp_activity_at?: string | null;
};

function hashStable(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomNonce(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function cleanDigits(value: string): string {
  return value.replace(/[^\d+]/g, '');
}

export function normalizePhone(raw: unknown): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  let normalized = cleanDigits(value);
  if (!normalized) return null;
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (normalized.startsWith('+')) {
    const digits = normalized.slice(1);
    if (!/^\d+$/.test(digits) || digits.length < PHONE_MIN_DIGITS || digits.length > PHONE_MAX_DIGITS) return null;
    return `+${digits}`;
  }
  if (!/^\d+$/.test(normalized) || normalized.length < PHONE_MIN_DIGITS || normalized.length > PHONE_MAX_DIGITS) return null;
  return `+${normalized}`;
}

export function deriveWhatsAppActorKey(phoneE164: string): string {
  return hashStable(`${WHATSAPP_ACTOR_SALT}:whatsapp:${phoneE164}`);
}

export function deriveContributorKeyFromPhone(phoneE164: string): string {
  return hashStable(`${CONTRIBUTOR_SALT}:contact:${phoneE164.toLowerCase()}`);
}

export function deriveContributorKeyFromUser(userId: string): string {
  return hashStable(`${CONTRIBUTOR_SALT}:user:${String(userId).trim().toLowerCase()}`);
}

async function writeAudit(input: {
  actionCode: string;
  userId?: string | null;
  contributorKey?: string | null;
  actorKey?: string | null;
  phoneE164?: string | null;
  performedBy?: string | null;
  reason?: string | null;
}): Promise<void> {
  await execute(`
    INSERT INTO identity_link_audit (
      id, action_code, user_id, contributor_key, actor_key, phone_e164, performed_by, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `, [
    uuidv4(),
    input.actionCode,
    input.userId || null,
    input.contributorKey || null,
    input.actorKey || null,
    input.phoneE164 || null,
    input.performedBy || null,
    input.reason || null,
  ]);
}

async function createConflict(input: {
  conflictType: string;
  phoneE164?: string | null;
  userId?: string | null;
  contributorKey?: string | null;
  details?: string | null;
}): Promise<void> {
  await execute(`
    INSERT INTO identity_link_conflicts (
      id, conflict_type, phone_e164, user_id, contributor_key, details, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'open', NOW())
  `, [
    uuidv4(),
    input.conflictType,
    input.phoneE164 || null,
    input.userId || null,
    input.contributorKey || null,
    input.details || null,
  ]);
}

export async function mergeContributorProfiles(params: {
  targetContributorKey: string;
  sourceContributorKey: string;
  mergedBy: string;
  reason: string;
}): Promise<void> {
  const { targetContributorKey, sourceContributorKey, mergedBy, reason } = params;
  if (!targetContributorKey || !sourceContributorKey || targetContributorKey === sourceContributorKey) return;

  const targetUserLink = await queryOne<{ user_id: string }>('SELECT user_id FROM user_contributor_links WHERE contributor_key = ?', [targetContributorKey]);
  const sourceUserLink = await queryOne<{ user_id: string }>('SELECT user_id FROM user_contributor_links WHERE contributor_key = ?', [sourceContributorKey]);
  if (targetUserLink?.user_id && sourceUserLink?.user_id && targetUserLink.user_id !== sourceUserLink.user_id) {
    throw new Error('Cannot merge contributors linked to different users');
  }

  await execute('UPDATE reports SET contributor_key = ? WHERE contributor_key = ?', [targetContributorKey, sourceContributorKey]);

  const sourceAwards = await queryAll<any>('SELECT * FROM contributor_badge_awards WHERE contributor_key = ?', [sourceContributorKey]);
  for (const award of sourceAwards) {
    const activeTarget = award.revoked_at
      ? null
      : await queryOne<{ id: string }>(
          'SELECT id FROM contributor_badge_awards WHERE contributor_key = ? AND badge_code = ? AND revoked_at IS NULL',
          [targetContributorKey, award.badge_code]
        );
    if (activeTarget && !award.revoked_at) {
      await execute('UPDATE contributor_badge_awards SET revoked_at = COALESCE(revoked_at, NOW()) WHERE id = ?', [award.id]);
      continue;
    }
    await execute('UPDATE contributor_badge_awards SET contributor_key = ? WHERE id = ?', [targetContributorKey, award.id]);
  }

  await execute('UPDATE contributor_score_events SET contributor_key = ? WHERE contributor_key = ?', [targetContributorKey, sourceContributorKey]);

  const sourceAliases = await queryAll<{ actor_key: string; source: string; first_seen_at?: string; last_seen_at?: string }>(
    'SELECT actor_key, source, first_seen_at, last_seen_at FROM contributor_identity_aliases WHERE contributor_key = ?',
    [sourceContributorKey]
  );
  for (const alias of sourceAliases) {
    await execute(`
      INSERT INTO contributor_identity_aliases (contributor_key, actor_key, source, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, COALESCE(?, NOW()), COALESCE(?, NOW()))
      ON CONFLICT (contributor_key, actor_key) DO UPDATE SET
        source = EXCLUDED.source,
        last_seen_at = GREATEST(contributor_identity_aliases.last_seen_at, EXCLUDED.last_seen_at)
    `, [targetContributorKey, alias.actor_key, alias.source, alias.first_seen_at || null, alias.last_seen_at || null]);
  }
  await execute('DELETE FROM contributor_identity_aliases WHERE contributor_key = ?', [sourceContributorKey]);

  if (sourceUserLink?.user_id && !targetUserLink?.user_id) {
    await execute(`
      INSERT INTO user_contributor_links (user_id, contributor_key, link_source, linked_at, created_at, updated_at)
      VALUES (?, ?, 'merge', NOW(), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE SET contributor_key = EXCLUDED.contributor_key, updated_at = NOW(), linked_at = NOW()
    `, [sourceUserLink.user_id, targetContributorKey]);
  }
  await execute('DELETE FROM user_contributor_links WHERE contributor_key = ?', [sourceContributorKey]);

  await execute(`
    INSERT INTO contributor_merges (source_contributor_key, target_contributor_key, merged_at, merged_by, reason)
    VALUES (?, ?, NOW(), ?, ?)
    ON CONFLICT (source_contributor_key) DO UPDATE SET
      target_contributor_key = EXCLUDED.target_contributor_key,
      merged_at = NOW(),
      merged_by = EXCLUDED.merged_by,
      reason = EXCLUDED.reason
  `, [sourceContributorKey, targetContributorKey, mergedBy, reason]);

  await writeAudit({
    actionCode: 'merge_contributors',
    contributorKey: targetContributorKey,
    performedBy: mergedBy,
    reason: `${reason} (merged ${sourceContributorKey} into ${targetContributorKey})`,
  });

  await recomputeContributorProfile(targetContributorKey);
  await execute('DELETE FROM contributor_profiles WHERE contributor_key = ?', [sourceContributorKey]);
}

function pickCanonicalContributor(candidates: string[], stats: Record<string, { resolved: number; firstVerifiedAt: string | null }>, preferred?: string | null): string {
  if (preferred && candidates.includes(preferred)) return preferred;
  return [...candidates].sort((a, b) => {
    const aStats = stats[a] || { resolved: 0, firstVerifiedAt: null };
    const bStats = stats[b] || { resolved: 0, firstVerifiedAt: null };
    if (bStats.resolved !== aStats.resolved) return bStats.resolved - aStats.resolved;
    const aTime = aStats.firstVerifiedAt ? new Date(aStats.firstVerifiedAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = bStats.firstVerifiedAt ? new Date(bStats.firstVerifiedAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.localeCompare(b);
  })[0];
}

async function getContributorStats(contributorKey: string): Promise<{ resolved: number; firstVerifiedAt: string | null }> {
  const row = await queryOne<{ resolved: number; first_verified_at?: string | null }>(
    `SELECT
      (COALESCE(reports_verified, 0) + COALESCE(reports_duplicate, 0) + COALESCE(reports_rejected, 0))::int AS resolved,
      first_verified_at
     FROM contributor_profiles WHERE contributor_key = ?`,
    [contributorKey]
  );
  return { resolved: row?.resolved || 0, firstVerifiedAt: row?.first_verified_at || null };
}

export async function ensureUserContributorLink(userId: string, contributorKey: string, linkSource: string): Promise<void> {
  const existingByContributor = await queryOne<{ user_id: string }>('SELECT user_id FROM user_contributor_links WHERE contributor_key = ?', [contributorKey]);
  if (existingByContributor?.user_id && existingByContributor.user_id !== userId) {
    throw new Error('Contributor already linked to a different user');
  }
  await execute(`
    INSERT INTO user_contributor_links (user_id, contributor_key, link_source, linked_at, created_at, updated_at)
    VALUES (?, ?, ?, NOW(), NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      contributor_key = EXCLUDED.contributor_key,
      link_source = EXCLUDED.link_source,
      linked_at = NOW(),
      updated_at = NOW()
  `, [userId, contributorKey, linkSource]);
}

export async function startPhoneVerification(userId: string, rawPhone: unknown): Promise<{ phone_e164: string; nonce: string; expires_at: string }> {
  const phoneE164 = normalizePhone(rawPhone);
  if (!phoneE164) throw new Error('Enter a valid phone number in international format');

  const existingVerified = await queryOne<{ user_id: string }>('SELECT user_id FROM user_phone_verifications WHERE phone_e164 = ?', [phoneE164]);
  if (existingVerified?.user_id && existingVerified.user_id !== userId) {
    await createConflict({
      conflictType: 'phone_already_verified',
      phoneE164,
      userId,
      details: `Phone already verified by ${existingVerified.user_id}`,
    });
    throw new Error('This phone number is already verified on another account');
  }

  const nonce = randomNonce();
  const expiresAt = new Date(Date.now() + (PHONE_VERIFY_TTL_MINUTES * 60 * 1000)).toISOString();
  await execute('UPDATE whatsapp_sessions SET verification_nonce = NULL, verification_user_id = NULL, verification_expires_at = NULL WHERE verification_user_id = ?', [userId]);
  await execute(`
    INSERT INTO whatsapp_sessions (
      phone, phone_e164, actor_key, data, updated_at, verification_nonce, verification_user_id, verification_expires_at
    ) VALUES (?, ?, ?, '{}'::jsonb, EXTRACT(EPOCH FROM NOW())::bigint, ?, ?, ?)
    ON CONFLICT (phone) DO UPDATE SET
      phone_e164 = EXCLUDED.phone_e164,
      actor_key = EXCLUDED.actor_key,
      verification_nonce = EXCLUDED.verification_nonce,
      verification_user_id = EXCLUDED.verification_user_id,
      verification_expires_at = EXCLUDED.verification_expires_at,
      updated_at = EXTRACT(EPOCH FROM NOW())::bigint
  `, [phoneE164, phoneE164, deriveWhatsAppActorKey(phoneE164), nonce, userId, expiresAt]);
  await execute('UPDATE users SET phone = ? WHERE id = ?', [phoneE164, userId]);

  await writeAudit({
    actionCode: 'start_phone_verification',
    userId,
    phoneE164,
    actorKey: deriveWhatsAppActorKey(phoneE164),
    performedBy: userId,
    reason: 'User started WhatsApp phone verification',
  });

  return { phone_e164: phoneE164, nonce, expires_at: expiresAt };
}

export async function completePhoneVerification(phoneE164Input: unknown, nonceInput: unknown): Promise<{ user_id: string; contributor_key: string; phone_e164: string }> {
  const phoneE164 = normalizePhone(phoneE164Input);
  const nonce = String(nonceInput || '').trim().toUpperCase();
  if (!phoneE164 || !nonce) throw new Error('Valid phone and nonce are required');

  const pending = await queryOne<any>(
    `SELECT phone, phone_e164, actor_key, verification_nonce, verification_user_id, verification_expires_at
     FROM whatsapp_sessions
     WHERE phone = ? OR phone_e164 = ?`,
    [phoneE164, phoneE164]
  );
  if (!pending?.verification_user_id || !pending?.verification_nonce) throw new Error('No active verification request for this phone');
  if (String(pending.verification_nonce).toUpperCase() !== nonce) throw new Error('Verification code does not match');
  if (!pending.verification_expires_at || new Date(pending.verification_expires_at).getTime() < Date.now()) {
    throw new Error('Verification code expired');
  }

  const userId = String(pending.verification_user_id);
  const existingUserVerification = await queryOne<{ phone_e164: string }>('SELECT phone_e164 FROM user_phone_verifications WHERE user_id = ?', [userId]);
  const existingVerified = await queryOne<{ user_id: string }>('SELECT user_id FROM user_phone_verifications WHERE phone_e164 = ?', [phoneE164]);
  if (existingVerified?.user_id && existingVerified.user_id !== userId) {
    await createConflict({
      conflictType: 'phone_verified_conflict',
      phoneE164,
      userId,
      details: `Attempted to verify phone already owned by ${existingVerified.user_id}`,
    });
    throw new Error('This phone number is already verified on another account');
  }

  const phoneContributorKey = deriveContributorKeyFromPhone(phoneE164);
  const actorKey = pending.actor_key || deriveWhatsAppActorKey(phoneE164);
  const existingLink = await queryOne<{ contributor_key: string }>('SELECT contributor_key FROM user_contributor_links WHERE user_id = ?', [userId]);
  const contributorCandidates = Array.from(new Set([phoneContributorKey, existingLink?.contributor_key].filter(Boolean) as string[]));
  const stats: Record<string, { resolved: number; firstVerifiedAt: string | null }> = {};
  for (const candidate of contributorCandidates) {
    stats[candidate] = await getContributorStats(candidate);
  }

  const canonicalContributor = pickCanonicalContributor(contributorCandidates, stats, existingLink?.contributor_key || null);
  const otherCandidates = contributorCandidates.filter((candidate) => candidate !== canonicalContributor);

  for (const candidate of otherCandidates) {
    const linkedUser = await queryOne<{ user_id: string }>('SELECT user_id FROM user_contributor_links WHERE contributor_key = ?', [candidate]);
    if (linkedUser?.user_id && linkedUser.user_id !== userId) {
      await createConflict({
        conflictType: 'contributor_link_conflict',
        phoneE164,
        userId,
        contributorKey: candidate,
        details: `Contributor already linked to ${linkedUser.user_id}`,
      });
      throw new Error('Contributor is already linked to another user');
    }
  }

  if (existingUserVerification?.phone_e164 && existingUserVerification.phone_e164 !== phoneE164) {
    await execute('DELETE FROM user_phone_verifications WHERE user_id = ? AND phone_e164 <> ?', [userId, phoneE164]);
  }

  await execute(`
    INSERT INTO user_phone_verifications (user_id, phone_e164, verified_at, verification_source, verified_by, created_at)
    VALUES (?, ?, NOW(), 'whatsapp_nonce', ?, NOW())
    ON CONFLICT (phone_e164) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      verified_at = NOW(),
      verification_source = EXCLUDED.verification_source,
      verified_by = EXCLUDED.verified_by
  `, [userId, phoneE164, userId]);

  await execute('UPDATE users SET phone = ? WHERE id = ?', [phoneE164, userId]);

  await ensureUserContributorLink(userId, canonicalContributor, 'phone_verified');
  for (const candidate of otherCandidates) {
    await mergeContributorProfiles({
      targetContributorKey: canonicalContributor,
      sourceContributorKey: candidate,
      mergedBy: userId,
      reason: 'Verified phone link consolidation',
    });
  }

  await execute(`
    INSERT INTO contributor_identity_aliases (contributor_key, actor_key, source, first_seen_at, last_seen_at)
    VALUES (?, ?, 'whatsapp', NOW(), NOW())
    ON CONFLICT (contributor_key, actor_key) DO UPDATE SET last_seen_at = NOW(), source = EXCLUDED.source
  `, [canonicalContributor, actorKey]);

  await execute(`
    UPDATE whatsapp_sessions
    SET verification_nonce = NULL, verification_user_id = NULL, verification_expires_at = NULL,
        phone_e164 = ?, actor_key = ?, updated_at = EXTRACT(EPOCH FROM NOW())::bigint
    WHERE phone = ? OR phone_e164 = ?
  `, [phoneE164, actorKey, phoneE164, phoneE164]);

  await writeAudit({
    actionCode: 'complete_phone_verification',
    userId,
    contributorKey: canonicalContributor,
    actorKey,
    phoneE164,
    performedBy: userId,
    reason: 'WhatsApp verification completed',
  });

  await recomputeContributorProfile(canonicalContributor);
  return { user_id: userId, contributor_key: canonicalContributor, phone_e164: phoneE164 };
}

export async function clearPhoneVerification(userId: string, performedBy: string): Promise<void> {
  const verification = await queryOne<{ phone_e164: string }>('SELECT phone_e164 FROM user_phone_verifications WHERE user_id = ?', [userId]);
  await execute('DELETE FROM user_phone_verifications WHERE user_id = ?', [userId]);
  await execute('UPDATE whatsapp_sessions SET verification_nonce = NULL, verification_user_id = NULL, verification_expires_at = NULL WHERE verification_user_id = ?', [userId]);
  if (verification?.phone_e164) {
    await execute(
      'UPDATE whatsapp_sessions SET verification_nonce = NULL, verification_user_id = NULL, verification_expires_at = NULL WHERE phone = ? OR phone_e164 = ?',
      [verification.phone_e164, verification.phone_e164]
    );
  }
  await writeAudit({
    actionCode: 'remove_phone_verification',
    userId,
    phoneE164: verification?.phone_e164 || null,
    performedBy,
    reason: 'Phone verification removed',
  });
}

export async function getIdentitySummary(userId: string): Promise<IdentitySummary> {
  const user = await queryOne<{ phone?: string | null }>('SELECT phone FROM users WHERE id = ?', [userId]);
  const verification = await queryOne<{ phone_e164: string; verified_at?: string }>('SELECT phone_e164, verified_at FROM user_phone_verifications WHERE user_id = ?', [userId]);
  const link = await queryOne<{ contributor_key: string }>('SELECT contributor_key FROM user_contributor_links WHERE user_id = ?', [userId]);
  const contributor = link?.contributor_key
    ? await queryOne<any>(
        `SELECT cp.*,
          COALESCE((
            SELECT jsonb_agg(cba.badge_code ORDER BY cba.awarded_at DESC)
            FROM contributor_badge_awards cba
            WHERE cba.contributor_key = cp.contributor_key AND cba.revoked_at IS NULL
          ), '[]'::jsonb) AS badges
        FROM contributor_profiles cp
        WHERE cp.contributor_key = ?`,
        [link.contributor_key]
      )
    : undefined;
  const verifiedSession = verification?.phone_e164
    ? await queryOne<{ updated_at?: number; verification_nonce?: string | null; verification_expires_at?: string | null; phone_e164?: string | null }>(
        'SELECT updated_at, verification_nonce, verification_expires_at, phone_e164 FROM whatsapp_sessions WHERE phone = ? OR phone_e164 = ?',
        [verification.phone_e164, verification.phone_e164]
      )
    : null;
  const pendingSession = await queryOne<{ updated_at?: number; verification_nonce?: string | null; verification_expires_at?: string | null; phone_e164?: string | null }>(
    'SELECT updated_at, verification_nonce, verification_expires_at, phone_e164 FROM whatsapp_sessions WHERE verification_user_id = ? ORDER BY updated_at DESC LIMIT 1',
    [userId]
  );

  const derivedPhone = verification?.phone_e164
    || normalizePhone(user?.phone || null)
    || (pendingSession ? normalizePhone((pendingSession as any).phone_e164 || null) : null)
    || (verifiedSession ? normalizePhone((verifiedSession as any).phone_e164 || null) : null);
  const verifiedPhone = verification?.phone_e164 || null;
  const pendingPhone = pendingSession?.verification_nonce
    ? normalizePhone((pendingSession as any).phone_e164 || null)
    : null;
  return {
    phone: (verifiedPhone || pendingPhone || derivedPhone) || null,
    verified_phone: verifiedPhone,
    pending_phone: pendingPhone,
    phone_verified: Boolean(verifiedPhone),
    linked_contributor_key: link?.contributor_key || null,
    verification_pending: Boolean(pendingSession?.verification_nonce),
    verification_nonce: pendingSession?.verification_nonce || null,
    verification_expires_at: pendingSession?.verification_expires_at || null,
    contributor,
    last_whatsapp_activity_at: (pendingSession?.updated_at || verifiedSession?.updated_at)
      ? new Date(Number(pendingSession?.updated_at || verifiedSession?.updated_at) * 1000).toISOString()
      : null,
  };
}

export async function listIdentityConflicts(): Promise<IdentityConflict[]> {
  return queryAll<IdentityConflict>('SELECT * FROM identity_link_conflicts WHERE status = \'open\' ORDER BY created_at DESC');
}

export async function manualLinkUserToContributor(userId: string, contributorKey: string, performedBy: string, reason: string): Promise<void> {
  await ensureUserContributorLink(userId, contributorKey, 'admin_manual');
  await writeAudit({
    actionCode: 'manual_link_user_contributor',
    userId,
    contributorKey,
    performedBy,
    reason,
  });
  await recomputeContributorProfile(contributorKey);
}

export async function adminVerifyPhone(userId: string, rawPhone: unknown, performedBy: string, reason: string): Promise<{ phone_e164: string; contributor_key: string }> {
  const phoneE164 = normalizePhone(rawPhone);
  if (!phoneE164) throw new Error('Enter a valid phone number in international format');
  const contributorKey = deriveContributorKeyFromPhone(phoneE164);
  const existingVerified = await queryOne<{ user_id: string }>('SELECT user_id FROM user_phone_verifications WHERE phone_e164 = ?', [phoneE164]);
  if (existingVerified?.user_id && existingVerified.user_id !== userId) {
    throw new Error('This phone number is already verified on another account');
  }
  await execute('DELETE FROM user_phone_verifications WHERE user_id = ? AND phone_e164 <> ?', [userId, phoneE164]);
  await execute(`
    INSERT INTO user_phone_verifications (user_id, phone_e164, verified_at, verification_source, verified_by, created_at)
    VALUES (?, ?, NOW(), 'admin', ?, NOW())
    ON CONFLICT (phone_e164) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      verified_at = NOW(),
      verification_source = EXCLUDED.verification_source,
      verified_by = EXCLUDED.verified_by
  `, [userId, phoneE164, performedBy]);
  await execute('UPDATE users SET phone = ? WHERE id = ?', [phoneE164, userId]);
  await ensureUserContributorLink(userId, contributorKey, 'admin_manual');
  await writeAudit({
    actionCode: 'admin_verify_phone',
    userId,
    contributorKey,
    phoneE164,
    performedBy,
    reason,
  });
  await recomputeContributorProfile(contributorKey);
  return { phone_e164: phoneE164, contributor_key: contributorKey };
}
