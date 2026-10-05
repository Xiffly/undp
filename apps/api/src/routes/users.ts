import { logger } from '../observability/logger';
import express, { Request, Response } from 'express';
import { createAdminSession, isTrustedSessionRequest } from '../services/adminSessions';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes } from 'crypto';
import { queryAll, queryOne, execute, withTransaction } from '../dbRuntime';
import { authMiddleware, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { buildMediaUrl, deleteMediaKeys, isAllowedPublicImageMimeType, MediaValidationError, saveMediaFile } from '../media';
import { sendPasswordResetEmail } from '../email';
import {
  deriveContributorKeyFromUser,
  completePhoneVerification,
  clearPhoneVerification,
  ensureUserContributorLink,
  getIdentitySummary,
  normalizePhone,
  startPhoneVerification,
} from '../services/identityLinking';
import { requirePrivacyConsent } from '../middleware/consent';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || '';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedPublicImageMimeType(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP, GIF, and AVIF images are allowed'));
  },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_RESET_TTL_MINUTES = parseInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES || '60', 10);
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  message: { error: 'Too many password reset attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const authSurfaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '10', 10),
  message: { error: 'Too many authentication attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function sanitizeText(value: unknown, maxLen: number): string {
  return String(value || '').trim().slice(0, maxLen);
}

function isStrongPassword(password: string): boolean {
  return password.length >= 10;
}

function isAllowedStaffRole(role: string): role is 'field_officer' | 'team_lead' | 'admin' {
  return ['field_officer', 'team_lead', 'admin'].includes(role);
}

function normalizeCountryCode(value: unknown): string | null {
  const clean = String(value || '').trim().toUpperCase();
  if (!clean) return null;
  return /^[A-Z]{2}$/.test(clean) ? clean : null;
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createResetToken() {
  return randomBytes(32).toString('hex');
}

function getRequestIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 120);
  }
  return req.socket.remoteAddress?.slice(0, 120) || null;
}

async function formatUser(user: any) {
  if (!user) return user;
  return {
    ...user,
    profile_photo_url: user.profile_photo_key ? await buildMediaUrl(user.profile_photo_key) : null,
  };
}

router.post('/admin-create', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, password, role = 'field_officer', organization, phone, address_line, country_code } = req.body;
    const email = normalizeEmail(req.body?.email);
    const cleanName = sanitizeText(name, 120);

    if (!cleanName || !email || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (!isStrongPassword(String(password))) {
      res.status(400).json({ error: 'Password must be at least 10 characters' });
      return;
    }

    if (!isAllowedStaffRole(role)) {
      res.status(400).json({ error: 'Invalid role. Must be field_officer, team_lead, or admin' });
      return;
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) { res.status(409).json({ error: 'Email already registered' }); return; }
    const normalizedPhone = phone !== undefined && phone !== null && String(phone).trim()
      ? normalizePhone(phone)
      : null;
    if (phone && !normalizedPhone) {
      res.status(400).json({ error: 'Phone must be a valid international number' });
      return;
    }
    const normalizedCountryCode = country_code !== undefined ? normalizeCountryCode(country_code) : null;
    if (country_code && !normalizedCountryCode) {
      res.status(400).json({ error: 'Country must be a valid 2-letter ISO code' });
      return;
    }

    const hash = await bcrypt.hash(String(password), 12);
    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    await execute(`
      INSERT INTO users (id, name, email, password_hash, role, organization, phone, address_line, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, cleanName, email, hash, role, sanitizeText(organization, 120) || null, normalizedPhone || null, sanitizeText(address_line, 200) || null, normalizedCountryCode || null]);

    const user = await queryOne('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at FROM users WHERE id = ?', [id]);
    res.status(201).json({ success: true, user: await formatUser(user) });
  } catch (err: any) {
    logger.error('admin.user.creation.failed', { details: [err] });
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/register', authSurfaceLimiter, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!JWT_SECRET) {
      res.status(500).json({ error: 'Authentication is not configured' });
      return;
    }
    const { name, password, organization, phone, address_line, country_code } = req.body;
    const email = normalizeEmail(req.body?.email);
    const cleanName = sanitizeText(name, 120);

    if (!cleanName || !email || !password) {
      res.status(400).json({ error: 'name, email, and password are required' });
      return;
    }

    if (!EMAIL_RE.test(email)) {
      res.status(400).json({ error: 'Invalid email format' });
      return;
    }

    if (!isStrongPassword(String(password))) {
      res.status(400).json({ error: 'Password must be at least 10 characters' });
      return;
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) { res.status(409).json({ error: 'Email already registered' }); return; }
    const normalizedPhone = phone !== undefined && phone !== null && String(phone).trim()
      ? normalizePhone(phone)
      : null;
    if (phone && !normalizedPhone) {
      res.status(400).json({ error: 'Phone must be a valid international number' });
      return;
    }
    const normalizedCountryCode = country_code !== undefined ? normalizeCountryCode(country_code) : null;
    if (country_code && !normalizedCountryCode) {
      res.status(400).json({ error: 'Country must be a valid 2-letter ISO code' });
      return;
    }

    const hash = await bcrypt.hash(String(password), 12);
    const id = `user-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    await execute(`
      INSERT INTO users (id, name, email, password_hash, role, organization, phone, address_line, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, cleanName, email, hash, 'public_user', sanitizeText(organization, 120) || null, normalizedPhone || null, sanitizeText(address_line, 200) || null, normalizedCountryCode || null]);

    const contributorKey = deriveContributorKeyFromUser(id);
    await ensureUserContributorLink(id, contributorKey, 'public_signup');

    const user = await queryOne('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at FROM users WHERE id = ?', [id]);
    const token = jwt.sign(
      { id, email, role: 'public_user', name: cleanName },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.status(201).json({ success: true, token, user: await formatUser(user) });
  } catch (err: any) {
    logger.error('public.registration.failed', { details: [err] });
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/forgot-password', passwordResetLimiter, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  const genericResponse = {
    success: true,
    message: 'If an account exists for that email, a password reset link has been sent.',
  };

  try {
    const email = normalizeEmail(req.body?.email);
    if (!email || !EMAIL_RE.test(email)) {
      res.json(genericResponse);
      return;
    }

    const user = await queryOne<{ id: string; email: string; active: boolean }>(
      'SELECT id, email, active FROM users WHERE email = ? AND active = TRUE',
      [email]
    );
    if (!user) {
      res.json(genericResponse);
      return;
    }

    const token = createResetToken();
    const tokenHash = hashResetToken(token);
    const tokenId = `prt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const requestIp = getRequestIp(req);
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 400) || null;
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();

    await execute(
      `INSERT INTO password_reset_tokens (id, user_id, email, token_hash, expires_at, request_ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tokenId, user.id, user.email, tokenHash, expiresAt, requestIp, userAgent]
    );

    try {
      await sendPasswordResetEmail(user.email, token);
    } catch (mailErr) {
      await execute('DELETE FROM password_reset_tokens WHERE id = ?', [tokenId]).catch((error: unknown) => logger.error('cleanup.failed', { error }));
      throw mailErr;
    }
    res.json(genericResponse);
  } catch (err) {
    logger.error('forgot.password.request.failed', { details: [err] });
    res.json(genericResponse);
  }
});

router.post('/reset-password', passwordResetLimiter, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  try {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.new_password || '');

    if (!token || !newPassword) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    if (!isStrongPassword(newPassword)) {
      res.status(400).json({ error: 'Password must be at least 10 characters' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    const changed = await withTransaction(async (db) => {
      const resetRow = await db.queryOne<{ id: string; user_id: string }>(
        `UPDATE password_reset_tokens SET used_at = NOW()
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
         RETURNING id, user_id`, [hashResetToken(token)]);
      if (!resetRow) return false;
      await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetRow.user_id]);
      await db.execute('DELETE FROM admin_sessions WHERE user_id = ?', [resetRow.user_id]);
      await db.execute('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL AND id <> ?', [resetRow.user_id, resetRow.id]);
      return true;
    });
    if (!changed) {
      res.status(400).json({ error: 'Reset link is invalid or has expired' });
      return;
    }


    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    logger.error('password.reset.failed', { details: [err] });
    res.status(500).json({ error: 'Password reset failed' });
  }
});

router.post('/login', authSurfaceLimiter, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  res.setHeader('Cache-Control', 'no-store');
  if (!isTrustedSessionRequest(req)) { res.status(403).json({ error: 'Untrusted request origin' }); return; }
  try {
    if (!JWT_SECRET) {
      res.status(500).json({ error: 'Authentication is not configured' });
      return;
    }
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!email || !password) { res.status(400).json({ error: 'Email and password required' }); return; }
    if (!EMAIL_RE.test(email)) { res.status(400).json({ error: 'Invalid email format' }); return; }

    const user = await queryOne<any>('SELECT * FROM users WHERE email = ? AND active = TRUE', [email]);
    if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { res.status(401).json({ error: 'Invalid credentials' }); return; }

    await execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);

    const operational = ['admin', 'team_lead', 'field_officer'].includes(user.role);
    if (operational) await createAdminSession(req, res, user.id);
    const token = operational && process.env.NODE_ENV === 'production' ? undefined : jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: operational ? '30m' : '7d', algorithm: 'HS256' }
    );

    res.json({
      token,
      user: await formatUser({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization: user.organization,
        phone: user.phone,
        address_line: user.address_line,
        country_code: user.country_code,
        profile_photo_key: user.profile_photo_key,
      })
    });
  } catch (err: any) {
    logger.error('user.login.failed', { details: [err] });
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const user = await queryOne<any>('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at, last_login FROM users WHERE id = ?', [(req as AuthenticatedRequest).user?.id]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(await formatUser(user));
});

router.patch('/me', authMiddleware, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).user?.id;
  const { name, organization, phone, address_line, country_code, currentPassword, newPassword } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name) { updates.push('name = ?'); params.push(sanitizeText(name, 120)); }
  if (organization !== undefined) { updates.push('organization = ?'); params.push(sanitizeText(organization, 120) || null); }
  if (phone !== undefined) {
    const normalizedPhone = String(phone).trim() ? normalizePhone(phone) : null;
    if (String(phone).trim() && !normalizedPhone) { res.status(400).json({ error: 'Phone must be a valid international number' }); return; }
    updates.push('phone = ?');
    params.push(normalizedPhone || null);
  }
  if (address_line !== undefined) {
    updates.push('address_line = ?');
    params.push(sanitizeText(address_line, 200) || null);
  }
  if (country_code !== undefined) {
    const normalizedCountryCode = String(country_code).trim() ? normalizeCountryCode(country_code) : null;
    if (String(country_code).trim() && !normalizedCountryCode) { res.status(400).json({ error: 'Country must be a valid 2-letter ISO code' }); return; }
    updates.push('country_code = ?');
    params.push(normalizedCountryCode || null);
  }

  if (newPassword) {
    if (!currentPassword) { res.status(400).json({ error: 'Current password required to set new password' }); return; }
    if (!isStrongPassword(String(newPassword))) { res.status(400).json({ error: 'New password must be at least 10 characters' }); return; }
    const user = await queryOne<any>('SELECT password_hash FROM users WHERE id = ?', [userId]);
    if (!user?.password_hash) { res.status(404).json({ error: 'User not found' }); return; }
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) { res.status(401).json({ error: 'Current password incorrect' }); return; }
    const hash = await bcrypt.hash(String(newPassword), 12);
    updates.push('password_hash = ?');
    params.push(hash);
  }

  if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(userId);
  await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await queryOne('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key FROM users WHERE id = ?', [userId]);
  res.json({ success: true, user: await formatUser(updated) });
});

router.get('/me/identity', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  res.json(await getIdentitySummary(userId));
});

router.post('/me/phone-verification/start', authMiddleware, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const verification = await startPhoneVerification(userId, req.body?.phone);
    res.json({
      success: true,
      ...verification,
      instructions: `Send code ${verification.nonce} to the WhatsApp bot from ${verification.phone_e164} before ${verification.expires_at}.`,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to start verification' });
  }
});

router.delete('/me/phone-verification', authMiddleware, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    await clearPhoneVerification(userId, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to remove verification' });
  }
});

router.post('/me/phone-verification/complete', authMiddleware, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as AuthenticatedRequest).user?.id;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const identity = await getIdentitySummary(userId);
    const phoneForCompletion = identity.pending_phone || identity.phone;
    if (!phoneForCompletion) { res.status(400).json({ error: 'No pending or verified phone found for this account' }); return; }
    const result = await completePhoneVerification(phoneForCompletion, req.body?.nonce);
    res.json({ success: true, ...result, identity: await getIdentitySummary(userId) });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to complete verification' });
  }
});

router.get('/', authMiddleware, requireRole('team_lead'), async (_req: Request, res: Response): Promise<void> => {
  const scope = String(_req.query.scope || 'staff').trim().toLowerCase();
  const whereClause = scope === 'public'
    ? "role = 'public_user'"
    : scope === 'all'
      ? '1=1'
      : "role <> 'public_user'";

  const users = await queryAll(
    `SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at, last_login, active
     FROM users
     WHERE ${whereClause}
     ORDER BY created_at DESC`
  );

  if (scope === 'public' || scope === 'all') {
    const withIdentity = await Promise.all(
      (users as any[]).map(async (user) => ({
        ...(await formatUser(user)),
        identity: await getIdentitySummary(user.id),
      }))
    );
    res.json({ users: withIdentity, total: withIdentity.length });
    return;
  }

  res.json({ users, total: (users as any[]).length });
});

router.get('/:id', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const user = await queryOne<any>(
    'SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at, last_login, active FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const identity = await getIdentitySummary(req.params.id);
  res.json({ user: await formatUser(user), identity });
});

router.patch('/:id', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const actingUserId = (req as AuthenticatedRequest).user?.id;
  const userId = req.params.id;
  const updates: string[] = [];
  const params: any[] = [];
  const role = req.body?.role !== undefined ? String(req.body.role).trim() : undefined;
  const active = req.body?.active;
  const organization = req.body?.organization;
  const phone = req.body?.phone;

  if (role !== undefined) {
    if (!isAllowedStaffRole(role)) {
      res.status(400).json({ error: 'Invalid role. Must be field_officer, team_lead, or admin' });
      return;
    }
    if (actingUserId === userId && role !== 'admin') {
      res.status(400).json({ error: 'You cannot change your own role through admin user management.' });
      return;
    }
    updates.push('role = ?');
    params.push(role);
  }

  if (active !== undefined) {
    const nextActive = active === true || active === 'true' || active === 1 || active === '1';
    if (actingUserId === userId && !nextActive) {
      res.status(400).json({ error: 'You cannot deactivate your own account through admin user management.' });
      return;
    }
    updates.push('active = ?');
    params.push(nextActive);
  }

  if (organization !== undefined) {
    updates.push('organization = ?');
    params.push(sanitizeText(organization, 120) || null);
  }

  if (phone !== undefined) {
    const normalizedPhone = String(phone).trim() ? normalizePhone(phone) : null;
    if (String(phone).trim() && !normalizedPhone) {
      res.status(400).json({ error: 'Phone must be a valid international number' });
      return;
    }
    updates.push('phone = ?');
    params.push(normalizedPhone || null);
  }

  if (!updates.length) {
    res.status(400).json({ error: 'Nothing to update' });
    return;
  }

  params.push(userId);
  await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await queryOne<any>(
    'SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key, created_at, last_login, active FROM users WHERE id = ?',
    [userId]
  );
  res.json({ success: true, user: await formatUser(updated), identity: await getIdentitySummary(userId) });
});

router.patch('/:id/deactivate', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const actingUserId = (req as AuthenticatedRequest).user?.id;
  if (actingUserId === req.params.id) {
    res.status(400).json({ error: 'You cannot deactivate your own account through admin user management.' });
    return;
  }
  await execute('UPDATE users SET active = FALSE WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.patch('/:id/activate', authMiddleware, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  await execute('UPDATE users SET active = TRUE WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.post('/me/avatar', authMiddleware, requirePrivacyConsent, upload.single('avatar'), async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).user?.id;
  const file = (req as Request & { file?: { buffer: Buffer; mimetype: string; originalname: string } }).file;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  if (!file) { res.status(400).json({ error: 'Avatar image is required' }); return; }
  try {
    const current = await queryOne<{ profile_photo_key?: string | null }>('SELECT profile_photo_key FROM users WHERE id = ?', [userId]);
    const nextKey = await saveMediaFile({
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    }, 'profiles');
    await execute('UPDATE users SET profile_photo_key = ? WHERE id = ?', [nextKey, userId]);
    if (current?.profile_photo_key && current.profile_photo_key !== nextKey) {
      await deleteMediaKeys([current.profile_photo_key]).catch((error: unknown) => logger.error('cleanup.failed', { error }));
    }
    const updated = await queryOne('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: await formatUser(updated) });
  } catch (err) {
    if (err instanceof MediaValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.delete('/me/avatar', authMiddleware, requirePrivacyConsent, async (req: Request, res: Response): Promise<void> => {
  const userId = (req as AuthenticatedRequest).user?.id;
  if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
  const current = await queryOne<{ profile_photo_key?: string | null }>('SELECT profile_photo_key FROM users WHERE id = ?', [userId]);
  if (current?.profile_photo_key) {
    await deleteMediaKeys([current.profile_photo_key]).catch((error: unknown) => logger.error('cleanup.failed', { error }));
  }
  await execute('UPDATE users SET profile_photo_key = NULL WHERE id = ?', [userId]);
  const updated = await queryOne('SELECT id, name, email, role, organization, phone, address_line, country_code, profile_photo_key FROM users WHERE id = ?', [userId]);
  res.json({ success: true, user: await formatUser(updated) });
});

export default router;
