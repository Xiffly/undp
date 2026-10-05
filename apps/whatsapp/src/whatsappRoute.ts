import express, { Request, Response } from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import FormData from 'form-data';
import { getSession, saveSession, clearSession, newSession } from './whatsapp/session';
import { sendWhatsAppMessage, markAsRead } from './whatsapp/sender';
import { downloadWhatsAppMedia } from './whatsapp/mediaDownload';
import { deriveWhatsAppActorKey, normalizePhone } from './whatsapp/identity';
import { deriveInfraCategoryFromTypes } from './whatsapp/intakeMapping';
import {
  badgeLabel,
  crisisLabel,
  damageLabel,
  detectLang,
  infraLabel,
  matchesCommand,
  msg,
  needsLabel,
  parseCrisisInput,
  parseDamageInput,
  parseInfraInput,
  parseNeedsInput,
  parseLanguageCommand,
} from './whatsapp/messages';

const router = express.Router();
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const WHATSAPP_UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const REPORT_ID_RE = /^CR-\d{4}-\d{4,}$/;
const INTEGRATION_TOKEN = process.env.WHATSAPP_SERVICE_TOKEN || process.env.INTEGRATION_TOKEN || '';
const WHATSAPP_APP_SECRET = (process.env.WHATSAPP_APP_SECRET || '').trim();
const WHATSAPP_USE_STUB = process.env.WHATSAPP_USE_STUB === 'true';

function normalizeCommand(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, '');
}

async function apiGet<T = any>(routePath: string): Promise<T> {
  const { data } = await axios.get(`${API_BASE}${routePath}`, { timeout: 15000 });
  return data as T;
}

async function apiPost<T = any>(routePath: string, payload: any, internal = false): Promise<T> {
  const { data } = await axios.post(`${API_BASE}${routePath}`, payload, {
    timeout: 15000,
    headers: internal ? { 'x-integration-token': INTEGRATION_TOKEN } : undefined,
  });
  return data as T;
}

async function submitWhatsAppReport(session: any, phoneE164: string): Promise<{ report?: { id?: string }; contributor?: { badge?: string; trust_score?: number } }> {
  const form = new FormData();
  form.append('lat', String(session.lat));
  form.append('lng', String(session.lng));
  form.append('address_text', session.address_text || '');
  form.append('infra_types', JSON.stringify(session.infra_types || []));
  form.append('infra_category', deriveInfraCategoryFromTypes(session.infra_types || []));
  if (session.crisis_type) form.append('crisis_type', session.crisis_type);
  form.append('damage_level', session.damage_level || 'partial');
  form.append('is_urgent', session.is_urgent ? 'true' : 'false');
  if (session.pressing_needs?.length) form.append('pressing_needs', JSON.stringify(session.pressing_needs));
  form.append('description', session.description || '');
  form.append('submitter_contact', phoneE164);
  form.append('actor_key', session.actor_key || deriveWhatsAppActorKey(phoneE164));
  form.append('channel', 'whatsapp');
  form.append('location_capture_mode', session.location_capture_mode || 'unknown');
  if (session.lang) form.append('source_language', session.lang);

  for (const photo of session.photos || []) {
    const fullPath = path.join(WHATSAPP_UPLOADS_DIR, path.basename(photo));
    if (fs.existsSync(fullPath)) {
      form.append('photos', fs.createReadStream(fullPath));
    }
  }

  const { data } = await axios.post(`${API_BASE}/api/reports`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    timeout: 45000,
  });
  return data;
}

function verificationFailureMessage(errorMessage: string | undefined, lang: any): string {
  const text = String(errorMessage || '').toLowerCase();
  if (text.includes('no active verification request')) return msg('verify_no_pending', lang);
  if (text.includes('does not match')) return msg('verify_invalid', lang);
  if (text.includes('expired')) return msg('verify_expired', lang);
  if (text.includes('already verified on another account')) return msg('verify_conflict', lang);
  return msg('verify_failed', lang);
}

function cleanupSessionPhotos(photos: string[] = []): void {
  for (const photo of photos) {
    const fullPath = path.join(WHATSAPP_UPLOADS_DIR, path.basename(photo));
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }
}

function hasValidWebhookSignature(req: Request): boolean {
  if (WHATSAPP_USE_STUB) return true;
  if (!WHATSAPP_APP_SECRET) return false;

  const signature = String(req.headers['x-hub-signature-256'] || '').trim();
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!signature.startsWith('sha256=') || !rawBody) return false;

  const expected = `sha256=${crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody).digest('hex')}`;
  const provided = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (provided.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuffer);
}

router.get('/webhook', (req: Request, res: Response): void => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WhatsApp] Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Forbidden' });
  }
});

router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  if (!hasValidWebhookSignature(req)) {
    console.warn('[WhatsApp] Rejected webhook with invalid signature');
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  res.status(200).json({ status: 'ok' });

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return;

    const from: string = message.from;
    const phoneE164 = normalizePhone(from);
    if (!phoneE164) return;
    const msgId: string = message.id;
    await markAsRead(msgId);

    let textInput = '';
    let locationLat: number | null = null;
    let locationLng: number | null = null;
    let locationName: string | null = null;
    let mediaId: string | null = null;

    if (message.type === 'text') {
      textInput = (message.text?.body || '').trim();
    } else if (message.type === 'location') {
      locationLat = message.location?.latitude;
      locationLng = message.location?.longitude;
      locationName = message.location?.name || message.location?.address || null;
    } else if (message.type === 'image') {
      mediaId = message.image?.id || null;
    } else if (message.type === 'document' || message.type === 'video') {
      return;
    }

    const session = await getSession(phoneE164);
    session.phone_e164 = phoneE164;
    session.actor_key = session.actor_key || deriveWhatsAppActorKey(phoneE164);

    if (textInput) {
      const maybeVerificationCode = textInput.trim().toUpperCase();
      if (session.verification_nonce && /^[A-Z0-9]{4,8}$/.test(maybeVerificationCode)) {
        try {
          await apiPost('/api/whatsapp/verification/complete', { phone_e164: phoneE164, nonce: maybeVerificationCode }, true);
          await clearSession(phoneE164);
          await sendWhatsAppMessage(from, msg('verify_success', session.lang || 'en'));
          return;
        } catch (err: any) {
          console.warn('[WhatsApp] Verification completion failed:', err.response?.data || err.message);
          await sendWhatsAppMessage(from, verificationFailureMessage(err.response?.data?.error || err.message, session.lang || 'en'));
          return;
        }
      }
      const explicitLang = parseLanguageCommand(textInput);
      if (explicitLang) {
        session.lang = explicitLang;
        session.step = session.step === 'idle' ? 'greeting' : session.step;
        await saveSession(phoneE164, session);
        await sendWhatsAppMessage(from, msg('language_switched', session.lang));
        await sendWhatsAppMessage(from, msg('welcome', session.lang));
        return;
      }
      session.lang = detectLang(textInput);
    }

    const lang = session.lang;
    const cmdNorm = normalizeCommand(textInput);

    if (matchesCommand('help', textInput) || session.step === 'idle') {
      cleanupSessionPhotos(session.photos || []);
      await clearSession(phoneE164);
      await sendWhatsAppMessage(from, msg('welcome', lang));
      const next = newSession();
      next.lang = lang;
      next.step = 'greeting';
      next.phone_e164 = phoneE164;
      next.actor_key = deriveWhatsAppActorKey(phoneE164);
      await saveSession(phoneE164, next);
      return;
    }

    switch (session.step) {
      case 'greeting': {
        if (matchesCommand('report', textInput)) {
          session.step = 'awaiting_location';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_location', lang));
        } else if (matchesCommand('status', textInput)) {
          session.step = 'check_status';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_status_id', lang));
        } else {
          session.step = 'awaiting_location';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_location', lang));
        }
        break;
      }

      case 'check_status': {
        const reportId = textInput.toUpperCase().trim();
        if (!REPORT_ID_RE.test(reportId)) {
          await sendWhatsAppMessage(from, msg('status_not_found', lang));
          break;
        }
        let report: any = null;
        try {
          report = await apiGet(`/api/reports/${encodeURIComponent(reportId)}`);
        } catch {
          report = null;
        }
        if (!report) {
          await sendWhatsAppMessage(from, msg('status_not_found', lang));
        } else {
          const formatted = {
            ...report,
            infra_types: Array.isArray(report.infra_types) ? report.infra_types : JSON.parse(report.infra_types || '[]'),
          };
          await sendWhatsAppMessage(from, msg('status_report', lang, formatted));
          await clearSession(phoneE164);
        }
        break;
      }

      case 'awaiting_location': {
        if (locationLat !== null && locationLng !== null) {
          session.lat = locationLat;
          session.lng = locationLng;
          session.address_text = locationName || session.address_text;
          session.location_capture_mode = 'gps';
          session.step = 'awaiting_infra';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_infra', lang));
        } else if (textInput.length > 2) {
          session.address_text = textInput;
          session.location_capture_mode = 'search';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('gps_required', lang));
        } else {
          await sendWhatsAppMessage(from, msg('ask_location', lang));
        }
        break;
      }

      case 'awaiting_infra': {
        const types = parseInfraInput(textInput);
        if (!types) {
          await sendWhatsAppMessage(from, msg('invalid_infra', lang));
        } else {
          session.infra_types = types;
          session.step = 'awaiting_crisis';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_crisis', lang));
        }
        break;
      }

      case 'awaiting_crisis': {
        const crisisType = parseCrisisInput(textInput);
        if (!crisisType) {
          await sendWhatsAppMessage(from, msg('invalid_crisis', lang));
        } else {
          session.crisis_type = crisisType;
          session.step = 'awaiting_damage';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_damage', lang));
        }
        break;
      }

      case 'awaiting_damage': {
        const level = parseDamageInput(textInput);
        if (!level) {
          await sendWhatsAppMessage(from, msg('invalid_damage', lang));
        } else {
          session.damage_level = level;
          session.step = 'awaiting_urgent';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_urgent', lang));
        }
        break;
      }

      case 'awaiting_urgent': {
        if (matchesCommand('yes', textInput)) {
          session.is_urgent = true;
          session.step = 'awaiting_needs';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_needs', lang));
        } else if (matchesCommand('no', textInput)) {
          session.is_urgent = false;
          session.step = 'awaiting_needs';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_needs', lang));
        } else {
          await sendWhatsAppMessage(from, msg('ask_urgent', lang));
        }
        break;
      }

      case 'awaiting_needs': {
        const needs = parseNeedsInput(textInput);
        if (!needs) {
          await sendWhatsAppMessage(from, msg('invalid_needs', lang));
        } else {
          session.pressing_needs = needs;
          session.step = 'awaiting_photos';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_photos', lang));
        }
        break;
      }

      case 'awaiting_photos': {
        if (mediaId) {
          const photos = session.photos || [];
          if (photos.length >= 3) {
            await sendWhatsAppMessage(from, msg('photo_limit', lang));
          } else {
            const filename = await downloadWhatsAppMedia(mediaId);
            if (filename) {
              photos.push(filename);
              session.photos = photos;
              await saveSession(phoneE164, session);
              await sendWhatsAppMessage(from, photos.length >= 3 ? msg('photo_limit', lang) : msg('photo_received', lang, photos.length));
            } else {
              await sendWhatsAppMessage(from, msg('error', lang));
            }
          }
        } else if (matchesCommand('skip', textInput)) {
          session.step = 'awaiting_description';
          await saveSession(phoneE164, session);
          await sendWhatsAppMessage(from, msg('ask_description', lang));
        } else {
          await sendWhatsAppMessage(from, msg('ask_photos', lang));
        }
        break;
      }

      case 'awaiting_description': {
        if (!matchesCommand('skip', textInput) && textInput.length > 0) {
          session.description = textInput;
        }
        session.step = 'confirming';
        await saveSession(phoneE164, session);
        await sendWhatsAppMessage(from, msg('confirm', lang, {
          address_text: session.address_text,
          lat: session.lat,
          lng: session.lng,
          infra_labels: infraLabel(session.infra_types || [], lang),
          crisis_label: crisisLabel(session.crisis_type || '', lang),
          damage_label: damageLabel(session.damage_level || '', lang),
          is_urgent: session.is_urgent,
          needs_label: needsLabel(session.pressing_needs || [], lang),
          photo_count: (session.photos || []).length,
          description: session.description,
        }));
        break;
      }

      case 'confirming': {
        if (matchesCommand('yes', textInput)) {
          if (session.lat == null || session.lng == null) {
            session.step = 'awaiting_location';
            await saveSession(phoneE164, session);
            await sendWhatsAppMessage(from, msg('gps_required', lang));
            break;
          }
          const created = await submitWhatsAppReport(session, phoneE164);
          const reportId = created?.report?.id || `CR-${new Date().getFullYear()}-PENDING`;
          await sendWhatsAppMessage(from, msg('submitted', lang, {
            reportId,
            badgeLabel: badgeLabel(created?.contributor?.badge || 'new_contributor', lang),
            trustScore: created?.contributor?.trust_score ?? 0,
          }));
          cleanupSessionPhotos(session.photos || []);
          await clearSession(phoneE164);
        } else if (matchesCommand('no', textInput)) {
          cleanupSessionPhotos(session.photos || []);
          await clearSession(phoneE164);
          const next = newSession();
          next.lang = lang;
          next.step = 'greeting';
          next.phone_e164 = phoneE164;
          next.actor_key = deriveWhatsAppActorKey(phoneE164);
          await saveSession(phoneE164, next);
          await sendWhatsAppMessage(from, msg('welcome', lang));
        } else if (cmdNorm) {
          await sendWhatsAppMessage(from, msg('confirm', lang, {
            address_text: session.address_text,
            lat: session.lat,
            lng: session.lng,
            infra_labels: infraLabel(session.infra_types || [], lang),
            crisis_label: crisisLabel(session.crisis_type || '', lang),
            damage_label: damageLabel(session.damage_level || '', lang),
            is_urgent: session.is_urgent,
            needs_label: needsLabel(session.pressing_needs || [], lang),
            photo_count: (session.photos || []).length,
            description: session.description,
          }));
        }
        break;
      }

      default: {
        cleanupSessionPhotos(session.photos || []);
        await clearSession(phoneE164);
        const next = newSession();
        next.lang = lang;
        next.step = 'greeting';
        next.phone_e164 = phoneE164;
        next.actor_key = deriveWhatsAppActorKey(phoneE164);
        await saveSession(phoneE164, next);
        await sendWhatsAppMessage(from, msg('welcome', lang));
        break;
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp] Webhook handler error:', err.message);
  }
});

export default router;
