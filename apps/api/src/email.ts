const APP_BASE_URL = process.env.APP_BASE_URL || process.env.PUBLIC_APP_BASE_URL || 'http://localhost:5173';
const MAIL_FROM = (process.env.MAIL_FROM || '').trim();
const RESEND_API_KEY = (process.env.RESEND_API_KEY || '').trim();
const ALLOW_INSECURE_PASSWORD_RESET_LOG = process.env.ALLOW_INSECURE_PASSWORD_RESET_LOG === 'true';

export function buildPasswordResetUrl(token: string) {
  const base = APP_BASE_URL.replace(/\/+$/, '');
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const resetUrl = buildPasswordResetUrl(token);

  if (!RESEND_API_KEY || !MAIL_FROM) {
    if (ALLOW_INSECURE_PASSWORD_RESET_LOG && process.env.NODE_ENV !== 'production') {
      console.warn(`[password-reset:dev-log] ${email} -> ${resetUrl}`);
      return { delivered: false as const, mode: 'log' as const, resetUrl };
    }
    throw new Error('Password reset email delivery is not configured');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [email],
      subject: 'Reset your UNDP Crisis Reporter password',
      text: `Use this link to reset your password: ${resetUrl}\n\nThis link expires soon. If you did not request a reset, you can ignore this email.`,
      html: `
        <p>Use the link below to reset your UNDP Crisis Reporter password.</p>
        <p><a href="${resetUrl}">${resetUrl}</a></p>
        <p>This link expires soon. If you did not request a reset, you can ignore this email.</p>
      `,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Password reset email failed (${response.status}): ${body || response.statusText}`);
  }

  return { delivered: true as const, mode: 'resend' as const, resetUrl };
}
