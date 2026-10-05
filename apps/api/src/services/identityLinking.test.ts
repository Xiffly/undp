import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  executeMock,
  queryOneMock,
  queryAllMock,
  recomputeContributorProfileMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  queryOneMock: vi.fn(),
  queryAllMock: vi.fn(),
  recomputeContributorProfileMock: vi.fn(),
}));

vi.mock('../dbRuntime', () => ({
  execute: executeMock,
  queryOne: queryOneMock,
  queryAll: queryAllMock,
}));

vi.mock('./contributorReputation', () => ({
  recomputeContributorProfile: recomputeContributorProfileMock,
}));

import {
  clearPhoneVerification,
  completePhoneVerification,
  deriveContributorKeyFromPhone,
  deriveWhatsAppActorKey,
  getIdentitySummary,
  normalizePhone,
  startPhoneVerification,
} from './identityLinking';

describe('identityLinking helpers', () => {
  beforeEach(() => {
    executeMock.mockReset();
    queryOneMock.mockReset();
    queryAllMock.mockReset();
    recomputeContributorProfileMock.mockReset();
  });

  it('normalizes phone numbers into e164-like form', () => {
    expect(normalizePhone('+353 87 123 4567')).toBe('+353871234567');
    expect(normalizePhone('00353 87 123 4567')).toBe('+353871234567');
    expect(normalizePhone('(415) 555-1212')).toBe('+4155551212');
  });

  it('rejects invalid or ambiguous phone values', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('1234')).toBeNull();
    expect(normalizePhone('+abc')).toBeNull();
  });

  it('derives stable whatsapp actor and contributor keys', () => {
    const phone = '+353871234567';
    expect(deriveWhatsAppActorKey(phone)).toBe(deriveWhatsAppActorKey(phone));
    expect(deriveContributorKeyFromPhone(phone)).toBe(deriveContributorKeyFromPhone(phone));
    expect(deriveWhatsAppActorKey(phone)).not.toBe(deriveContributorKeyFromPhone(phone));
  });
});

describe('identityLinking verification behavior', () => {
  beforeEach(() => {
    executeMock.mockReset();
    queryOneMock.mockReset();
    queryAllMock.mockReset();
    recomputeContributorProfileMock.mockReset();
  });

  it('replaces the previous verified phone when the same user verifies a new number', async () => {
    queryOneMock
      .mockResolvedValueOnce({
        phone: '+15550002222',
        phone_e164: '+15550002222',
        actor_key: 'actor-2',
        verification_nonce: 'ABC123',
        verification_user_id: 'user-1',
        verification_expires_at: '2999-01-01T00:00:00.000Z',
      })
      .mockResolvedValueOnce({ phone_e164: '+15550001111' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contributor_key: 'existing-contributor' })
      .mockResolvedValueOnce({ resolved: 5, first_verified_at: '2025-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ resolved: 0, first_verified_at: null })
      .mockResolvedValueOnce(null);

    queryAllMock.mockResolvedValue([]);

    const result = await completePhoneVerification('+15550002222', 'ABC123');

    expect(result.user_id).toBe('user-1');
    expect(result.phone_e164).toBe('+15550002222');
    expect(executeMock).toHaveBeenCalledWith(
      'DELETE FROM user_phone_verifications WHERE user_id = ? AND phone_e164 <> ?',
      ['user-1', '+15550002222']
    );
    expect(executeMock).toHaveBeenCalledWith('UPDATE users SET phone = ? WHERE id = ?', ['+15550002222', 'user-1']);
    expect(recomputeContributorProfileMock).toHaveBeenCalledWith('existing-contributor');
  });

  it('rejects verification start when another user already owns the phone', async () => {
    queryOneMock.mockResolvedValueOnce({ user_id: 'other-user' });

    await expect(startPhoneVerification('user-1', '+15550003333')).rejects.toThrow(
      'This phone number is already verified on another account'
    );

    expect(executeMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO identity_link_conflicts'),
      expect.arrayContaining([
        'phone_already_verified',
        '+15550003333',
        'user-1',
      ])
    );
  });

  it('exposes verified and pending phones separately during phone replacement', async () => {
    queryOneMock
      .mockResolvedValueOnce({ phone: '+15550002222' })
      .mockResolvedValueOnce({ phone_e164: '+15550001111', verified_at: '2026-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce({ contributor_key: 'existing-contributor' })
      .mockResolvedValueOnce({
        contributor_key: 'existing-contributor',
        primary_badge: 'trusted_contributor',
        trust_score: 88,
        points_total: 120,
        reports_submitted: 9,
      })
      .mockResolvedValueOnce({
        updated_at: 1780000000,
        verification_nonce: null,
        verification_expires_at: null,
        phone_e164: '+15550001111',
      })
      .mockResolvedValueOnce({
        updated_at: 1781000000,
        verification_nonce: 'ZXCV12',
        verification_expires_at: '2999-01-01T00:00:00.000Z',
        phone_e164: '+15550002222',
      });

    const summary = await getIdentitySummary('user-1');

    expect(summary.phone_verified).toBe(true);
    expect(summary.verified_phone).toBe('+15550001111');
    expect(summary.pending_phone).toBe('+15550002222');
    expect(summary.phone).toBe('+15550001111');
    expect(summary.verification_pending).toBe(true);
    expect(summary.verification_nonce).toBe('ZXCV12');
  });

  it('clears pending_phone when there is no active verification request', async () => {
    queryOneMock
      .mockResolvedValueOnce({ phone: '+15550001111' })
      .mockResolvedValueOnce({ phone_e164: '+15550001111', verified_at: '2026-01-01T00:00:00.000Z' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        updated_at: 1780000000,
        verification_nonce: null,
        verification_expires_at: null,
        phone_e164: '+15550001111',
      })
      .mockResolvedValueOnce(null);

    const summary = await getIdentitySummary('user-1');

    expect(summary.phone_verified).toBe(true);
    expect(summary.verified_phone).toBe('+15550001111');
    expect(summary.pending_phone).toBeNull();
    expect(summary.phone).toBe('+15550001111');
    expect(summary.verification_pending).toBe(false);
  });

  it('removing verification also clears pending verification requests for the same user', async () => {
    queryOneMock.mockResolvedValueOnce({ phone_e164: '+15550001111' });

    await clearPhoneVerification('user-1', 'user-1');

    expect(executeMock).toHaveBeenCalledWith('DELETE FROM user_phone_verifications WHERE user_id = ?', ['user-1']);
    expect(executeMock).toHaveBeenCalledWith(
      'UPDATE whatsapp_sessions SET verification_nonce = NULL, verification_user_id = NULL, verification_expires_at = NULL WHERE verification_user_id = ?',
      ['user-1']
    );
  });
});
