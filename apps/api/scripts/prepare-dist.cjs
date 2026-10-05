const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const distDir = path.join(appRoot, 'dist');

if (!fs.existsSync(distDir)) {
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rotatedDir = path.join(appRoot, `dist-stale-${stamp}`);

try {
  fs.renameSync(distDir, rotatedDir);
} catch (err) {
  if (err && err.code === 'EXDEV') {
    fs.cpSync(distDir, rotatedDir, { recursive: true });
    fs.rmSync(distDir, { recursive: true, force: true });
  } else {
    throw err;
  }
}

const staleDirs = fs.readdirSync(appRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('dist-stale-'))
  .map((entry) => entry.name)
  .sort();

for (const staleDir of staleDirs.slice(0, -3)) {
  try {
    fs.rmSync(path.join(appRoot, staleDir), { recursive: true, force: true });
  } catch {
    // Keep older stale outputs when the host still holds handles on them.
  }
}
