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

async function run() {
  await new Promise((r) => setTimeout(r, 800));

  const health = await request('http://127.0.0.1:3001/api/health');
  console.log('HEALTH_STATUS=' + health.status);

  const loginBody = JSON.stringify({ password: 'undp2024' });
  const login = await request('http://127.0.0.1:3001/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
    body: loginBody,
  });
  console.log('LOGIN_STATUS=' + login.status);
  const token = JSON.parse(login.body).token || '';
  console.log('TOKEN_OK=' + Boolean(token));

  const exp = await request('http://127.0.0.1:3001/api/export?format=json', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('EXPORT_JSON_STATUS=' + exp.status);

  const submitBody =
    'lat=15.5000&lng=44.3000&address_text=Core+Smoke+Test&infra_category=residential&crisis_type=flood&damage_level=partial&electricity_condition=minor&health_services=partially_functional&pressing_needs=%5B%22shelter%22%5D&description=Core+smoke+test';
  const submit = await request('http://127.0.0.1:3001/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(submitBody) },
    body: submitBody,
  });
  console.log('WEB_SUBMIT_STATUS=' + submit.status);

  const list = await request('http://127.0.0.1:3001/api/reports?limit=5');
  console.log('REPORT_LIST_STATUS=' + list.status);
}

run().catch((e) => {
  console.error('CORE_SMOKE_FAIL=' + e.message);
  process.exit(1);
});
