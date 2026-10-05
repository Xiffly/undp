const CACHE_NAME = 'undp-crisis-static-v2';
const RUNTIME_CACHE = 'undp-crisis-runtime-v3';
const DB_NAME = 'undp-crisis-offline';
const DB_VERSION = 2;
const STORE_NAME = 'reports_queue';
const BG_SYNC_TAG = 'report-sync';
const RETRYABLE_STATUSES = new Set([408, 425, 429]);
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000];

let syncInFlight = null;

const STATIC_ASSETS = ['/', '/index.html', '/manifest.json', '/undp-icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![CACHE_NAME, RUNTIME_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getQueuedReports() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function putQueuedReport(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function safeCachePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (_error) {
    // Storage quota can be exhausted on crisis-platform.com after heavy map use or large offline
    // payloads. Caching failures must not break submission or app-shell navigation.
  }
}

function getRetryDelayMs(attemptCount) {
  return RETRY_BACKOFF_MS[Math.min(Math.max(Number(attemptCount || 1) - 1, 0), RETRY_BACKOFF_MS.length - 1)];
}

function canRetryNow(item) {
  return !item.next_retry_at || item.next_retry_at <= Date.now();
}

function buildFormData(item) {
  const formData = new FormData();
  Object.entries(item.data || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) formData.append(key, String(value));
  });
  (item.photos || []).forEach((photo, index) => {
    formData.append('photos', photo, (item.photoNames || [])[index] || `offline-photo-${index + 1}.jpg`);
  });
  return formData;
}

async function syncQueuedReports() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
  const items = await getQueuedReports();
  const candidates = items.filter((item) =>
    item.status !== 'sent_confirmed'
    && (!item.expires_at || item.expires_at > Date.now())
    && canRetryNow(item)
  );

  for (const item of candidates) {
    const inFlight = {
      ...item,
      status: 'syncing',
      attempt_count: Number(item.attempt_count || 0) + 1,
      last_attempt_at: Date.now(),
      updated_at: Date.now(),
    };
    await putQueuedReport(inFlight);

    try {
      const headers = {};
      if (item.auth_token) {
        headers.Authorization = `Bearer ${item.auth_token}`;
      }
      if (item.consent_choice) {
        headers['X-Consent-Choice'] = item.consent_choice;
      }
      if (item.consent_version) {
        headers['X-Consent-Version'] = item.consent_version;
      }
      const response = await fetch('/api/reports', {
        method: 'POST',
        body: buildFormData(item),
        headers,
      });
      if (!response.ok) {
        const retryable = RETRYABLE_STATUSES.has(response.status) || response.status >= 500;
        await putQueuedReport({
          ...inFlight,
          status: retryable ? 'failed_retryable' : 'failed_terminal',
          error_message: `Request failed with status ${response.status}`,
          updated_at: Date.now(),
          next_retry_at: retryable ? Date.now() + getRetryDelayMs(inFlight.attempt_count) : null,
        });
        continue;
      }
      await putQueuedReport({
        ...inFlight,
        status: 'sent_confirmed',
        error_message: null,
        cleanup_at: Date.now() + (2 * 24 * 60 * 60 * 1000),
        updated_at: Date.now(),
        next_retry_at: null,
      });
    } catch (error) {
      await putQueuedReport({
        ...inFlight,
        status: 'failed_retryable',
        error_message: error && error.message ? error.message : 'Background sync failed',
        updated_at: Date.now(),
        next_retry_at: Date.now() + getRetryDelayMs(inFlight.attempt_count),
      });
    }
  }
  })();
  try {
    return await syncInFlight;
  } finally {
    syncInFlight = null;
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === BG_SYNC_TAG) {
    event.waitUntil(syncQueuedReports());
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  if (url.pathname.startsWith('/api/reports')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void safeCachePut(RUNTIME_CACHE, req, copy);
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Admin/editor API data must stay live. Locale bundles are cached so the
  // public app shell and submit flow can boot while offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req));
    return;
  }

  if (/^https:\/\/[a-c]\.tile\.openstreetmap\.org\//i.test(req.url)) {
    // Tile caching grows unbounded and is the main source of quota exhaustion in the browser.
    // The offline MVP only needs the public app shell and queue workflow, so keep tiles network-only.
    event.respondWith(fetch(req));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (url.origin === self.location.origin) {
            const copy = res.clone();
            void safeCachePut(RUNTIME_CACHE, req, copy);
          }
          return res;
        })
        .catch(() => caches.match('/index.html'));
    })
  );
});
