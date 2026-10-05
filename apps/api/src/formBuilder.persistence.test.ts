import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import axios, { AxiosError } from 'axios';

const adminEmail = process.env.ADMIN_EMAIL || 'bootstrap-admin@local';
const adminPassword = process.env.ADMIN_PASSWORD || 'change-me-to-a-strong-password';
const port = '3107';
const apiBase = `http://127.0.0.1:${port}/api`;

let server: ChildProcessWithoutNullStreams | null = null;
let consentHeaders: Record<string, string> = {};

function findField(payload: any, fieldKey: string) {
  for (const section of payload.sections || []) {
    for (const field of section.fields || []) {
      if (field.key === fieldKey) return { section, field };
    }
  }
  return null;
}

function getErrorStatus(error: unknown): number | undefined {
  return (error as AxiosError)?.response?.status;
}

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await axios.get(`${apiBase}/health`, { timeout: 1000 });
      if (response.data?.status === 'ok') return;
    } catch {
      // The test polls until the API is ready, so transient startup failures are expected here.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${apiBase}/health`);
}

describe('Form Builder persistence', () => {
  beforeAll(async () => {
    server = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/index.ts'], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        PORT: port,
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://crisis_user:change-me@localhost:5432/crisis_db',
        ADMIN_EMAIL: adminEmail,
        ADMIN_PASSWORD: adminPassword,
        JWT_SECRET: process.env.JWT_SECRET || 'change-this-in-production-use-a-64-char-random-string-generated-with-openssl',
        STRICT_INTEGRATIONS: 'true',
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD || 'change-me',
        CONTRIBUTOR_KEY_SALT: process.env.CONTRIBUTOR_KEY_SALT || 'change-me-contributor-salt',
        CONFIRM_IP_SALT: process.env.CONFIRM_IP_SALT || 'change-me-confirm-salt',
        AI_ENABLED: 'false',
      },
      stdio: 'pipe',
    });

    server.stderr.on('data', () => {});
    server.stdout.on('data', () => {});

    await waitForHealth();
    const consentConfig = await axios.get(`${apiBase}/consent/config`);
    consentHeaders = consentConfig.data?.banner_enabled
      ? {
          'X-Consent-Choice': 'accept_all',
          'X-Consent-Version': String(consentConfig.data?.consent_version || ''),
        }
      : {};
  }, 40000);

  afterAll(() => {
    if (server && !server.killed) {
      server.kill('SIGTERM');
    }
  });

  it('keeps the full form schema protected while the public schema remains open', async () => {
    await expect(axios.get(`${apiBase}/form-builder/default`)).rejects.toMatchObject({
      response: { status: 401 },
    });

    const publicSchema = await axios.get(`${apiBase}/form-builder/default/public`);
    expect(publicSchema.status).toBe(200);
    expect(Array.isArray(publicSchema.data?.sections)).toBe(true);
  });

  it('invalidates existing user tokens immediately after deactivation', async () => {
    const email = `security-${Date.now()}@example.test`;
    const register = await axios.post(`${apiBase}/users/register`, {
      name: 'Security Test User',
      email,
      password: 'ChangeMe12345',
    }, {
      headers: consentHeaders,
    });

    const userToken = register.data.token as string;
    const userId = register.data.user.id as string;
    const userAuth = { headers: { Authorization: `Bearer ${userToken}` } };

    const beforeDeactivate = await axios.get(`${apiBase}/users/me`, userAuth);
    expect(beforeDeactivate.status).toBe(200);
    expect(beforeDeactivate.data?.email).toBe(email);

    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const adminAuth = { headers: { Authorization: `Bearer ${login.data.token}` } };

    await axios.patch(`${apiBase}/users/${userId}/deactivate`, {}, adminAuth);

    await expect(axios.get(`${apiBase}/users/me`, userAuth)).rejects.toSatisfy((error: unknown) => {
      const status = getErrorStatus(error);
      return status === 401 || status === 403;
    });
  });

  it('does not leak translation metadata from public news endpoints', async () => {
    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const adminAuth = { headers: { Authorization: `Bearer ${login.data.token}` } };
    const title = `Security News ${Date.now()}`;

    const created = await axios.post(`${apiBase}/content/news`, {
      title,
      excerpt: 'Published security article excerpt',
      body: 'Published security article body',
    }, adminAuth);

    const articleId = created.data.article.id as string;
    const slug = created.data.article.slug as string;

    try {
      await axios.post(`${apiBase}/content/news/${articleId}/publish`, {}, adminAuth);

      const listResp = await axios.get(`${apiBase}/public/news`);
      const detailResp = await axios.get(`${apiBase}/public/news/${slug}`);

      const listed = (listResp.data?.articles || []).find((article: { id: string }) => article.id === articleId);
      expect(listed).toBeTruthy();
      expect(listed).not.toHaveProperty('translations_summary');
      expect(detailResp.data?.article).not.toHaveProperty('translations_summary');
    } finally {
      await axios.delete(`${apiBase}/content/news/${articleId}`, adminAuth).catch(() => {});
    }
  }, 40000);

  it('persists rename, reorder, and added fields across reloads', async () => {
    const unique = `Vitest ${Date.now()}`;
    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const auth = { headers: { Authorization: `Bearer ${login.data.token}` } };

    let createdFieldId: string | null = null;
    let originalInfraLabel = '';
    let originalImpactOrder: string[] = [];

    try {
      const initial = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      const infra = findField(initial, 'f_infra_category');
      expect(infra).toBeTruthy();
      originalInfraLabel = infra.field.label;

      await axios.patch(`${apiBase}/form-builder/default/${infra.field.id}`, { label: unique }, auth);
      const afterRename = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      expect(findField(afterRename, 'f_infra_category')?.field.label).toBe(unique);

      const impactSection = (afterRename.sections || []).find((section: any) => section.key === 'impact');
      expect(impactSection).toBeTruthy();
      originalImpactOrder = impactSection.fields.map((field: any) => field.key);
      const healthField = impactSection.fields.find((field: any) => field.key === 'f_health');
      expect(healthField).toBeTruthy();

      await axios.patch(`${apiBase}/form-builder/default/${healthField.id}`, { direction: 'up' }, auth);
      const afterMove = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      expect((afterMove.sections || []).find((section: any) => section.key === 'impact')?.fields?.[0]?.key).toBe('f_health');

      const created = await axios.post(`${apiBase}/form-builder/default/fields`, {
        section: 'impact',
        type: 'text',
        label: unique,
        description: 'temporary verification field',
        required: false,
        options: [],
      }, auth);
      const createdImpact = (created.data.sections || []).find((section: any) => section.key === 'impact');
      const createdField = (createdImpact.fields || []).find((field: any) => field.label === unique && field.key.startsWith('custom_'));
      expect(createdField).toBeTruthy();
      createdFieldId = createdField.id;

      const afterCreate = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      const persistedCreated = ((afterCreate.sections || []).find((section: any) => section.key === 'impact')?.fields || []).find((field: any) => field.id === createdFieldId);
      expect(Boolean(persistedCreated)).toBe(true);
    } finally {
      try {
        const latest = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
        const infra = findField(latest, 'f_infra_category');
        if (infra && originalInfraLabel && infra.field.label !== originalInfraLabel) {
          await axios.patch(`${apiBase}/form-builder/default/${infra.field.id}`, { label: originalInfraLabel }, auth);
        }

        if (createdFieldId) {
          await axios.delete(`${apiBase}/form-builder/default/${createdFieldId}`, auth);
        }

        if (originalImpactOrder.length) {
          let current = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
          let impact = (current.sections || []).find((section: any) => section.key === 'impact');
          let safety = 0;
          while (impact && impact.fields.map((field: any) => field.key).join('|') !== originalImpactOrder.join('|') && safety < 6) {
            const healthIndex = impact.fields.findIndex((field: any) => field.key === 'f_health');
            const electricityIndex = impact.fields.findIndex((field: any) => field.key === 'f_electricity');
            if (healthIndex >= 0 && electricityIndex >= 0 && healthIndex < electricityIndex) {
              await axios.patch(`${apiBase}/form-builder/default/${impact.fields[healthIndex].id}`, { direction: 'down' }, auth);
            }
            current = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
            impact = (current.sections || []).find((section: any) => section.key === 'impact');
            safety += 1;
          }
        }
      } catch {
        // Cleanup is best-effort so restore failures do not hide the primary assertion signal.
      }
    }
  }, 40000);

  it('persists section title edits and updates the English master locale', async () => {
    const unique = `Vitest Section ${Date.now()}`;
    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const auth = { headers: { Authorization: `Bearer ${login.data.token}` } };

    const initial = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
    const section = (initial.sections || []).find((entry: any) => entry.key === 'location');
    expect(section).toBeTruthy();
    const originalTitle = section.title;

    try {
      await axios.patch(`${apiBase}/form-builder/default/sections/location`, { title: unique }, auth);

      const afterRename = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      const afterSection = (afterRename.sections || []).find((entry: any) => entry.key === 'location');
      expect(afterSection?.title).toBe(unique);

      const translations = (await axios.get(`${apiBase}/form-builder/translations/en`, auth)).data;
      expect(translations?.locale?.submit?.location_title).toBe(unique);
    } finally {
      await axios.patch(`${apiBase}/form-builder/default/sections/location`, { title: originalTitle }, auth).catch(() => {});
    }
  }, 40000);

  it('persists core field label edits and updates the English master locale', async () => {
    const unique = `Nature of crisis ${Date.now()}`;
    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const auth = { headers: { Authorization: `Bearer ${login.data.token}` } };

    const initial = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
    const field = findField(initial, 'f_crisis_type')?.field;
    expect(field).toBeTruthy();
    const originalLabel = field.label;

    try {
      await axios.patch(`${apiBase}/form-builder/default/${field.id}`, { label: unique }, auth);

      const afterRename = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      const afterField = findField(afterRename, 'f_crisis_type')?.field;
      expect(afterField?.label).toBe(unique);

      const translations = (await axios.get(`${apiBase}/form-builder/translations/en`, auth)).data;
      expect(translations?.locale?.submit?.crisis_title_label).toBe(unique);
    } finally {
      await axios.patch(`${apiBase}/form-builder/default/${field.id}`, { label: originalLabel }, auth).catch(() => {});
    }
  }, 40000);

  it('persists core option label edits and updates the English master locale', async () => {
    const login = await axios.post(`${apiBase}/admin/login`, { email: adminEmail, password: adminPassword });
    const auth = { headers: { Authorization: `Bearer ${login.data.token}` } };
    const unique = `Flood ${Date.now()}`;

    const initial = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
    const crisisField = findField(initial, 'f_crisis_type')?.field;
    expect(crisisField).toBeTruthy();
    const originalFlood = (crisisField.options || []).find((option: any) => option.id === 'flood')?.label;
    expect(originalFlood).toBeTruthy();

    const updatedOptions = (crisisField.options || []).map((option: any) => ({
      id: option.id,
      label: option.id === 'flood' ? unique : option.label,
      label_key: option.label_key,
      order: option.order,
    }));

    try {
      await axios.patch(`${apiBase}/form-builder/default/${crisisField.id}`, { options: updatedOptions }, auth);

      const afterReload = (await axios.get(`${apiBase}/form-builder/default`, auth)).data;
      const afterField = findField(afterReload, 'f_crisis_type')?.field;
      const reloadedFlood = (afterField.options || []).find((option: any) => option.id === 'flood')?.label;
      expect(reloadedFlood).toBe(unique);

      const translations = (await axios.get(`${apiBase}/form-builder/translations/en`, auth)).data;
      expect(translations?.locale?.submit?.crisis_title_options?.options?.flood?.label).toBe(unique);
    } finally {
      const restoreOptions = (crisisField.options || []).map((option: any) => ({
        id: option.id,
        label: option.id === 'flood' ? originalFlood : option.label,
        label_key: option.label_key,
        order: option.order,
      }));
      await axios.patch(`${apiBase}/form-builder/default/${crisisField.id}`, { options: restoreOptions }, auth).catch(() => {});
    }
  }, 40000);
});
