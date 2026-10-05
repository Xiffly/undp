const http = require('http');

function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
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
  await sleep(800);

  const health = await request('http://127.0.0.1:3001/api/health');
  console.log('HEALTH_STATUS=' + health.status);

  const loginBody = JSON.stringify({ password: 'undp2024' });
  const login = await request('http://127.0.0.1:3001/api/admin/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(loginBody),
    },
    body: loginBody,
  });
  console.log('LOGIN_STATUS=' + login.status);

  const token = (() => {
    try {
      return JSON.parse(login.body).token || '';
    } catch {
      return '';
    }
  })();
  console.log('TOKEN_OK=' + Boolean(token));

  const exportJson = await request('http://127.0.0.1:3001/api/export?format=json', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('EXPORT_JSON_STATUS=' + exportJson.status);

  const submitBody =
    'lat=15.5000&lng=44.3000&address_text=Smoke+Test+Location&infra_category=residential&crisis_type=flood&damage_level=partial&electricity_condition=minor&health_services=partially_functional&pressing_needs=%5B%22shelter%22%5D&description=Smoke+test+web+submission';
  const submit = await request('http://127.0.0.1:3001/api/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(submitBody),
    },
    body: submitBody,
  });
  console.log('WEB_SUBMIT_STATUS=' + submit.status);

  const list = await request('http://127.0.0.1:3001/api/reports?limit=5');
  console.log('REPORT_LIST_STATUS=' + list.status);

    
  const phone = '15551230000';
  const waPayload = (msg) => ({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messages: [msg] } }] }],
  });

  const postWa = async (msg) => {
    const body = JSON.stringify(waPayload(msg));
    return request('http://127.0.0.1:3010/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
  };

  await postWa({ id: 'wa-1', from: phone, type: 'text', text: { body: 'start' } });
  await postWa({ id: 'wa-2', from: phone, type: 'text', text: { body: '1' } });
  await postWa({ id: 'wa-3', from: phone, type: 'location', location: { latitude: 15.5011, longitude: 44.3012 } });
  await postWa({ id: 'wa-4', from: phone, type: 'text', text: { body: '1' } });
  await postWa({ id: 'wa-5', from: phone, type: 'text', text: { body: '2' } });
  await postWa({ id: 'wa-6', from: phone, type: 'text', text: { body: 'no' } });
  await postWa({ id: 'wa-7', from: phone, type: 'text', text: { body: 'skip' } });
  await postWa({ id: 'wa-8', from: phone, type: 'text', text: { body: 'skip' } });
  await postWa({ id: 'wa-9', from: phone, type: 'text', text: { body: 'yes' } });

  await sleep(500);
  const adminReports = await request('http://127.0.0.1:3001/api/admin/reports?limit=20', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('ADMIN_REPORTS_STATUS=' + adminReports.status);
  const hasWa = (() => {
    try {
      const parsed = JSON.parse(adminReports.body);
      return Array.isArray(parsed.reports)
        ? parsed.reports.some((r) => r.channel === 'whatsapp' && r.submitter_contact === phone)
        : false;
    } catch {
      return false;
    }
  })();
  console.log('WHATSAPP_INSERT_OK=' + hasWa);
}

run().catch((err) => {
  console.error('SMOKE_FAIL=' + err.message);
  process.exit(1);
});
