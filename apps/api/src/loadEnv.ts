import fs from 'fs';
import path from 'path';
const inheritedEnvKeys = new Set(Object.keys(process.env));

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadEnvFile(filePath: string, override = false) {
  if (!fs.existsSync(filePath)) return;
  const parsed = parseEnvFile(fs.readFileSync(filePath, 'utf-8'));
  for (const [key, value] of Object.entries(parsed)) {
    if ((override && !inheritedEnvKeys.has(key)) || !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

const workspaceRoot = path.resolve(__dirname, '..', '..', '..');

loadEnvFile(path.join(workspaceRoot, '.env'));
loadEnvFile(path.join(workspaceRoot, '.env.local'), true);
