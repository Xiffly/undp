import express, { Request, Response } from 'express';
import { execute, queryOne } from '../dbRuntime';
import { requireIntegrationAuth } from '../middleware/auth';
import { completePhoneVerification, deriveWhatsAppActorKey, normalizePhone } from '../services/identityLinking';

const router = express.Router();

router.use(requireIntegrationAuth);

router.get('/sessions/:phone', async (req: Request, res: Response): Promise<void> => {
  const phoneE164 = normalizePhone(req.params.phone);
  if (!phoneE164) { res.status(400).json({ error: 'Invalid phone' }); return; }
  const session = await queryOne<any>(
    'SELECT phone, phone_e164, actor_key, data, updated_at, verification_nonce, verification_user_id, verification_expires_at FROM whatsapp_sessions WHERE phone = ? OR phone_e164 = ?',
    [phoneE164, phoneE164]
  );
  res.json({
    session: session ? {
      ...session,
      phone: session.phone_e164 || session.phone,
      phone_e164: session.phone_e164 || phoneE164,
      actor_key: session.actor_key || deriveWhatsAppActorKey(session.phone_e164 || phoneE164),
      data: session.data || {},
    } : null,
  });
});

router.put('/sessions/:phone', async (req: Request, res: Response): Promise<void> => {
  const phoneE164 = normalizePhone(req.params.phone);
  if (!phoneE164) { res.status(400).json({ error: 'Invalid phone' }); return; }
  const actorKey = String(req.body?.actor_key || deriveWhatsAppActorKey(phoneE164));
  await execute(`
    INSERT INTO whatsapp_sessions (
      phone, phone_e164, actor_key, data, updated_at, verification_nonce, verification_user_id, verification_expires_at
    ) VALUES (?, ?, ?, ?::jsonb, EXTRACT(EPOCH FROM NOW())::bigint, ?, ?, ?)
    ON CONFLICT (phone) DO UPDATE SET
      phone_e164 = EXCLUDED.phone_e164,
      actor_key = EXCLUDED.actor_key,
      data = EXCLUDED.data,
      verification_nonce = COALESCE(EXCLUDED.verification_nonce, whatsapp_sessions.verification_nonce),
      verification_user_id = COALESCE(EXCLUDED.verification_user_id, whatsapp_sessions.verification_user_id),
      verification_expires_at = COALESCE(EXCLUDED.verification_expires_at, whatsapp_sessions.verification_expires_at),
      updated_at = EXTRACT(EPOCH FROM NOW())::bigint
  `, [
    phoneE164,
    phoneE164,
    actorKey,
    JSON.stringify(req.body?.data || {}),
    req.body?.verification_nonce || null,
    req.body?.verification_user_id || null,
    req.body?.verification_expires_at || null,
  ]);
  res.json({ success: true, phone_e164: phoneE164, actor_key: actorKey });
});

router.delete('/sessions/:phone', async (req: Request, res: Response): Promise<void> => {
  const phoneE164 = normalizePhone(req.params.phone);
  if (!phoneE164) { res.status(400).json({ error: 'Invalid phone' }); return; }
  await execute('DELETE FROM whatsapp_sessions WHERE phone = ? OR phone_e164 = ?', [phoneE164, phoneE164]);
  res.json({ success: true });
});

router.post('/verification/complete', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await completePhoneVerification(req.body?.phone_e164, req.body?.nonce);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Verification failed' });
  }
});

export default router;
