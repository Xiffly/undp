#!/usr/bin/env node
/**
 * OpenRouter-based draft translation helper for locale files.
 *
 * This mirrors the admin endpoint policy:
 * - English is the source of truth
 * - translations are drafts only
 * - placeholders like {{count}} must be preserved exactly
 *
 * Usage:
 *   node scripts/auto-translate.cjs --lang fr
 *   node scripts/auto-translate.cjs --lang fr --force
 */

const fs = require('fs');
const path = require('path');

const LOCALES_DIR = path.join(__dirname, '../public/locales');
const SOURCE_LANG = 'en';
const BATCH_SIZE = Math.max(1, Math.min(parseInt(process.env.UI_TRANSLATION_BATCH_SIZE || '40', 10), 100));
const LANGUAGES = new Set(['ar', 'fr', 'es', 'ru', 'zh']);
const HIDDEN_PREFIXES = ['home.'];

const args = process.argv.slice(2);
const lang = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : '';
const force = args.includes('--force');

if (!LANGUAGES.has(lang)) {
  console.error('Usage: node scripts/auto-translate.cjs --lang <ar|fr|es|ru|zh> [--force]');
  process.exit(1);
}

const apiKey = (process.env.TRANSLATION_API_KEY || process.env.AI_API_KEY || '').trim();
const model = (process.env.TRANSLATION_MODEL || process.env.AI_MODEL_TEXT || 'openrouter/free').trim();
const baseUrl = ((process.env.TRANSLATION_API_BASE_URL || '').trim().replace(/\/$/, '')) || 'https://openrouter.ai/api/v1';
if (!apiKey) {
  console.error('Missing TRANSLATION_API_KEY or AI_API_KEY.');
  process.exit(1);
}

function flatten(obj, prefix = '', output = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, nextKey, output);
    else output[nextKey] = String(value ?? '');
  }
  return output;
}

function unflatten(flat) {
  const result = {};
  for (const [compoundKey, value] of Object.entries(flat)) {
    const parts = compoundKey.split('.');
    let cursor = result;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor[parts[i]] = cursor[parts[i]] || {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return result;
}

function chunk(entries, size) {
  const out = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

function isEditableKey(key) {
  return !HIDDEN_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function placeholders(input) {
  return input.match(/\{\{[^}]+\}\}/g) || [];
}

function hasSamePlaceholders(source, translated) {
  const a = placeholders(source).sort();
  const b = placeholders(translated).sort();
  return a.length === b.length && a.every((token, index) => token === b[index]);
}

async function translateBatch(batchEntries) {
  const payload = Object.fromEntries(batchEntries);
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://crisis-platform.com',
      'X-Title': 'UNDP Crisis Assessment Platform',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Translate UI locale JSON from English. Return only a JSON object with the exact same keys. Preserve placeholders like {{count}} exactly.',
        },
        {
          role: 'user',
          content: `Translate this JSON from ${SOURCE_LANG} to ${lang}:\n${JSON.stringify(payload)}`,
        },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`OpenRouter request failed (${resp.status}): ${detail.slice(0, 300)}`);
  }

  const data = await resp.json();
  const content = String(data?.choices?.[0]?.message?.content || '').trim();
  const parsed = JSON.parse(content);
  const result = {};

  for (const [key, sourceValue] of batchEntries) {
    const translated = String(parsed?.[key] || '').trim();
    result[key] = translated && hasSamePlaceholders(sourceValue, translated) ? translated : sourceValue;
  }

  return result;
}

async function main() {
  const sourcePath = path.join(LOCALES_DIR, SOURCE_LANG, 'translation.json');
  const targetPath = path.join(LOCALES_DIR, lang, 'translation.json');
  const sourceFlat = flatten(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const targetFlat = fs.existsSync(targetPath) ? flatten(JSON.parse(fs.readFileSync(targetPath, 'utf8'))) : {};
  const keysToTranslate = Object.entries(sourceFlat).filter(([key, value]) => isEditableKey(key) && (force || !targetFlat[key] || targetFlat[key] === value));

  for (const batch of chunk(keysToTranslate, BATCH_SIZE)) {
    const translated = await translateBatch(batch);
    Object.assign(targetFlat, translated);
  }

  fs.writeFileSync(targetPath, `${JSON.stringify(unflatten({ ...sourceFlat, ...targetFlat }), null, 2)}\n`, 'utf8');
  console.log(`OpenRouter draft saved: ${targetPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
