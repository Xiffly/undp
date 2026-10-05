import crypto from 'node:crypto';

const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 15;
const WHATSAPP_ACTOR_SALT = process.env.WHATSAPP_ACTOR_SALT || process.env.CONTRIBUTOR_KEY_SALT || 'crisis-contributor-salt';

function hashStable(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizePhone(raw: unknown): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  let normalized = value.replace(/[^\d+]/g, '');
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
