export function validateStartupConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['JWT_SECRET', 'CONTRIBUTOR_KEY_SALT', 'CONFIRM_IP_SALT']) {
    if (!env[key] || env[key]!.length < 32 || /change[-_ ]?me|change-this/i.test(env[key]!)) {
      throw new Error(`${key} must contain at least 32 characters and cannot be a placeholder`);
    }
  }
  if (!env.APP_BASE_URL || new URL(env.APP_BASE_URL).protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use HTTPS in production');
  }
  if (env.AI_ALLOW_INSECURE_TLS === 'true') throw new Error('Insecure AI TLS is forbidden in production');
}
