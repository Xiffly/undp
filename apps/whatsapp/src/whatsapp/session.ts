import axios from 'axios';
import { Lang } from './messages';
import { deriveWhatsAppActorKey, normalizePhone } from './identity';

export type ConversationStep =
  | 'idle'
  | 'greeting'
  | 'awaiting_location'
  | 'awaiting_infra'
  | 'awaiting_crisis'
  | 'awaiting_damage'
  | 'awaiting_urgent'
  | 'awaiting_needs'
  | 'awaiting_photos'
  | 'awaiting_description'
  | 'confirming'
  | 'check_status';

export interface SessionData {
  step: ConversationStep;
  lang: Lang;
  actor_key?: string;
  phone_e164?: string;
  verification_nonce?: string | null;
  verification_expires_at?: string | null;
  lat?: number;
  lng?: number;
  address_text?: string;
  location_capture_mode?: 'gps' | 'search' | 'unknown';
  infra_types?: string[];
  crisis_type?: string;
  damage_level?: string;
  is_urgent?: boolean;
  pressing_needs?: string[];
  photos?: string[];
  description?: string;
  last_activity: number;
}

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const INTEGRATION_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN || process.env.INTEGRATION_TOKEN || '';
const TTL = 30 * 60 * 1000;

function headers() {
  return { 'x-integration-token': INTEGRATION_TOKEN };
}

export function newSession(): SessionData {
  return { step: 'idle', lang: 'en', photos: [], last_activity: Date.now() };
}

export async function getSession(phone: string): Promise<SessionData> {
  const phoneE164 = normalizePhone(phone) || phone;
  try {
    const { data } = await axios.get(`${API_BASE}/api/whatsapp/sessions/${encodeURIComponent(phoneE164)}`, {
      headers: headers(),
      timeout: 10000,
    });
    const stored = data?.session?.data as SessionData | undefined;
    const updatedAt = Number(data?.session?.updated_at || 0) * 1000;
    if (!stored || !updatedAt || (Date.now() - updatedAt) > TTL) return { ...newSession(), phone_e164: phoneE164, actor_key: deriveWhatsAppActorKey(phoneE164) };
    return {
      ...newSession(),
      ...stored,
      phone_e164: data.session.phone_e164 || phoneE164,
      actor_key: data.session.actor_key || deriveWhatsAppActorKey(phoneE164),
      verification_nonce: data.session.verification_nonce || null,
      verification_expires_at: data.session.verification_expires_at || null,
      last_activity: updatedAt,
    };
  } catch {
    return { ...newSession(), phone_e164: phoneE164, actor_key: deriveWhatsAppActorKey(phoneE164) };
  }
}

export async function saveSession(phone: string, data: SessionData): Promise<void> {
  const phoneE164 = normalizePhone(phone) || phone;
  data.last_activity = Date.now();
  data.phone_e164 = phoneE164;
  data.actor_key = data.actor_key || deriveWhatsAppActorKey(phoneE164);
  await axios.put(`${API_BASE}/api/whatsapp/sessions/${encodeURIComponent(phoneE164)}`, {
    actor_key: data.actor_key,
    data,
  }, {
    headers: headers(),
    timeout: 10000,
  });
}

export async function clearSession(phone: string): Promise<void> {
  const phoneE164 = normalizePhone(phone) || phone;
  await axios.delete(`${API_BASE}/api/whatsapp/sessions/${encodeURIComponent(phoneE164)}`, {
    headers: headers(),
    timeout: 10000,
  }).catch(() => {});
}
