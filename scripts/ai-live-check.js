const { spawn } = require('child_process');
const http = require('http');

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  if (!process.env.AI_API_KEY) {
    throw new Error('AI_API_KEY missing');
  }

  const api = spawn(process.execPath, ['dist/index.js'], {
    cwd: 'e:/crisis-platform/apps/api',
    stdio: 'ignore',
    env: {
      ...process.env,
      STRICT_INTEGRATIONS: 'true',
      NODE_ENV: 'production',
      PORT: '3001',
    },
  });

  try {
    await sleep(2500);

    const health = await request('http://127.0.0.1:3001/api/health');
    console.log('STRICT_HEALTH_STATUS=' + health.status);

    const loginBody = JSON.stringify({ password: 'undp2024' });
    const login = await request('http://127.0.0.1:3001/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
      body: loginBody,
    });
    console.log('STRICT_LOGIN_STATUS=' + login.status);

    let token = '';
    try {
      token = JSON.parse(login.body).token || '';
    } catch {}
    console.log('STRICT_TOKEN_OK=' + Boolean(token));

    
    const patchBody = JSON.stringify({ provider: 'openrouter' });
    const patchProvider = await request('http://127.0.0.1:3001/api/ai/settings', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(patchBody),
      },
      body: patchBody,
    });
    console.log('AI_PROVIDER_PATCH_STATUS=' + patchProvider.status);

    const aiStatus = await request('http://127.0.0.1:3001/api/ai/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('AI_STATUS_ENDPOINT=' + aiStatus.status);
    try {
      const parsed = JSON.parse(aiStatus.body);
      console.log('AI_STRICT_MODE=' + Boolean(parsed.strict_mode));
      console.log('AI_HAS_KEY=' + Boolean(parsed.has_api_key));
      console.log('AI_PROVIDER=' + String(parsed.provider || 'unknown'));
    } catch {
      console.log('AI_STATUS_PARSE=false');
    }

    const aiModels = await request('http://127.0.0.1:3001/api/ai/models', {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log('AI_MODELS_STATUS=' + aiModels.status);
    try {
      const parsed = JSON.parse(aiModels.body);
      console.log('AI_MODELS_SOURCE=' + (parsed.source || 'unknown'));
      const vision = parsed?.models?.vision || [];
      const text = parsed?.models?.text || [];
      const all = [...vision, ...text].map(String);
      const free = all.filter((m) => m.includes(':free'));
      console.log('AI_FREE_MODELS_FOUND=' + (free.length > 0));
      console.log('AI_FREE_MODELS_SAMPLE=' + free.slice(0, 5).join('|'));
    } catch {
      console.log('AI_MODELS_PARSE=false');
    }
  } finally {
    try {
      api.kill();
    } catch {}
  }
}

run().catch((err) => {
  console.error('AI_CHECK_FAIL=' + err.message);
  process.exit(1);
});
