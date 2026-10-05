import { expect, it } from 'vitest';
import { validateStartupConfig } from './config';

it('refuses incomplete or insecure production configuration', () => {
  const env = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://test', JWT_SECRET: 'a'.repeat(32), CONTRIBUTOR_KEY_SALT: 'b'.repeat(32), CONFIRM_IP_SALT: 'c'.repeat(32), APP_BASE_URL: 'https://test.invalid' };
  expect(() => validateStartupConfig(env)).not.toThrow();
  expect(() => validateStartupConfig({ ...env, JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
  expect(() => validateStartupConfig({ ...env, APP_BASE_URL: 'http://test.invalid' })).toThrow('HTTPS');
  expect(() => validateStartupConfig({ ...env, AI_ALLOW_INSECURE_TLS: 'true' })).toThrow('TLS');
});
