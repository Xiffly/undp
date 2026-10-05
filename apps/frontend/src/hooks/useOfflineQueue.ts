import { useState, useEffect, useCallback } from 'react';
import { PUBLIC_AUTH_TOKEN_KEY, usePublicAuthStore } from '../store/publicAuth';
import { readStoredConsent } from '../consent/storage';

export type QueueStatus = 'queued' | 'syncing' | 'failed' | 'failed_retryable' | 'failed_terminal' | 'sent_confirmed';

export interface QueuedReport {
  id: string;
  data: Record<string, string>;
  photos: Blob[];
  photoNames: string[];
  created_at: number;
  updated_at: number;
  last_attempt_at?: number | null;
  attempt_count: number;
  owner_user_id?: string | null;
  owner_email?: string | null;
  auth_token?: string | null;
  consent_choice?: string | null;
  consent_version?: string | null;
  status: QueueStatus;
  error_message?: string | null;
  expires_at: number;
  cleanup_at?: number | null;
  next_retry_at?: number | null;
}

const QUEUE_KEY = 'offline_report_queue';
const DB_NAME = 'undp-crisis-offline';
const DB_VERSION = 2;
const STORE_NAME = 'reports_queue';
const UNSENT_RETENTION_DAYS = 14;
const TOMBSTONE_RETENTION_DAYS = 2;
const BG_SYNC_TAG = 'report-sync';
const QUEUE_SIZE_EVENT = 'offline-queue-size-change';
const STALE_SYNCING_MS = 90 * 1000;
const RETRY_BACKOFF_MS = [5000, 15000, 30000, 60000, 120000, 300000];

let syncInFlight: Promise<number> | null = null;

function now() {
  return Date.now();
}

function buildExpiry(days: number) {
  return now() + (days * 24 * 60 * 60 * 1000);
}

function isExpired(item: QueuedReport) {
  return item.status !== 'sent_confirmed' && item.expires_at <= now();
}

function shouldCleanup(item: QueuedReport) {
  return item.status === 'sent_confirmed' && item.cleanup_at !== undefined && item.cleanup_at !== null && item.cleanup_at <= now();
}

function summarizeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Sync failed. Try again when connectivity returns.';
}

export type QueueSyncFailure = {
  message: string;
  retryable: boolean;
  statusCode?: number;
};

class QueueSyncError extends Error {
  retryable: boolean;
  statusCode?: number;

  constructor({ message, retryable, statusCode }: QueueSyncFailure) {
    super(message);
    this.name = 'QueueSyncError';
    this.retryable = retryable;
    this.statusCode = statusCode;
  }
}

export function classifyQueueSyncFailure(statusCode?: number, detail?: string): QueueSyncFailure {
  const message = String(detail || '').trim() || (statusCode ? `Request failed with status ${statusCode}` : 'Sync failed. Try again when connectivity returns.');
  if (!statusCode) {
    return { message, retryable: true };
  }
  if (statusCode >= 500 || statusCode === 408 || statusCode === 425 || statusCode === 429) {
    return { message, retryable: true, statusCode };
  }
  if (statusCode >= 400 && statusCode < 500) {
    return { message, retryable: false, statusCode };
  }
  return { message, retryable: true, statusCode };
}

function isAutoRetryStatus(status: QueueStatus) {
  return status === 'queued' || status === 'failed' || status === 'failed_retryable';
}

function isStaleSyncing(item: QueuedReport) {
  return item.status === 'syncing' && Number(item.last_attempt_at || 0) > 0 && (now() - Number(item.last_attempt_at || 0)) >= STALE_SYNCING_MS;
}

function getRetryDelayMs(attemptCount: number) {
  return RETRY_BACKOFF_MS[Math.min(Math.max(attemptCount - 1, 0), RETRY_BACKOFF_MS.length - 1)];
}

function canRetryNow(item: QueuedReport) {
  return !item.next_retry_at || item.next_retry_at <= now();
}

function getApiBase() {
  return import.meta.env.VITE_API_URL || '';
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function buildReportFormData(item: QueuedReport) {
  const formData = new FormData();
  Object.entries(item.data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) formData.append(key, String(value));
  });
  item.photos.forEach((photo, index) => {
    formData.append('photos', photo, item.photoNames[index] || `offline-photo-${index + 1}.jpg`);
  });
  return formData;
}

async function submitQueuedItem(item: QueuedReport): Promise<void> {
  const headers: Record<string, string> = {};
  if (item.auth_token) {
    headers.Authorization = `Bearer ${item.auth_token}`;
  }
  if (item.consent_choice) {
    headers['X-Consent-Choice'] = item.consent_choice;
  }
  if (item.consent_version) {
    headers['X-Consent-Version'] = item.consent_version;
  }
  const response = await fetch(`${getApiBase()}/api/reports`, {
    method: 'POST',
    body: buildReportFormData(item),
    headers,
  });
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const data = await response.json();
      detail = data?.error || data?.detail || detail;
    } catch {
      throw new QueueSyncError(classifyQueueSyncFailure(response.status, detail));
    }
    throw new QueueSyncError(classifyQueueSyncFailure(response.status, detail));
  }
}

function openDb(): Promise<IDBDatabase> {
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

async function idbGetAll(): Promise<QueuedReport[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.created_at - b.created_at));
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(item: QueuedReport): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const syncManager = (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync;
  if (!syncManager?.register) return;
  await syncManager.register(BG_SYNC_TAG);
}

function triggerBackgroundSyncIfPossible() {
  if (!navigator.onLine) return;
  void registerBackgroundSync().catch(() => {});
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueSize, setQueueSize] = useState(0);
  const [lastSyncCount, setLastSyncCount] = useState(0);

  const refreshQueueSize = useCallback(async () => {
    const items = await idbGetAll();
    const activeItems = items.filter((item) => item.status !== 'sent_confirmed');
    const nextSize = activeItems.length;
    setQueueSize(nextSize);
    window.dispatchEvent(new CustomEvent<number>(QUEUE_SIZE_EVENT, { detail: nextSize }));
  }, []);

  const cleanupQueue = useCallback(async () => {
    const items = await idbGetAll();
    for (const item of items) {
      if (isExpired(item) || shouldCleanup(item)) {
        await idbDelete(item.id);
      }
    }
    await refreshQueueSize();
  }, [refreshQueueSize]);

  useEffect(() => {
    const initialRefreshId = scheduleTask(() => {
      refreshQueueSize().catch(() => {});
    });
    const initialCleanupId = scheduleTask(() => {
      cleanupQueue().catch(() => {});
    });
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleVisibility = () => {
      if (!document.hidden) {
        scheduleTask(() => {
          cleanupQueue().catch(() => {});
        });
      }
    };
    const handleQueueSize = (event: Event) => {
      const nextSize = (event as CustomEvent<number>).detail;
      if (typeof nextSize === 'number') setQueueSize(nextSize);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(QUEUE_SIZE_EVENT, handleQueueSize);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener(QUEUE_SIZE_EVENT, handleQueueSize);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.clearTimeout(initialRefreshId);
    window.clearTimeout(initialCleanupId);
    };
  }, [cleanupQueue, refreshQueueSize]);

  useEffect(() => {
    const migrateLegacyQueue = async () => {
      try {
        const legacy = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as Array<{ data: Record<string, string>; timestamp: number }>;
        if (!Array.isArray(legacy) || !legacy.length) return;
        for (const item of legacy) {
          await idbPut({
            id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            data: item.data || {},
            photos: [],
            photoNames: [],
            created_at: item.timestamp || now(),
            updated_at: now(),
            last_attempt_at: null,
            attempt_count: 0,
            owner_user_id: null,
            owner_email: null,
            auth_token: null,
            status: 'queued',
            error_message: null,
            expires_at: buildExpiry(UNSENT_RETENTION_DAYS),
            cleanup_at: null,
            next_retry_at: null,
          });
        }
        localStorage.removeItem(QUEUE_KEY);
        await refreshQueueSize();
      } catch {
        return;
      }
    };
    const migrationId = scheduleTask(() => {
      migrateLegacyQueue().catch(() => {});
    });
    return () => window.clearTimeout(migrationId);
  }, [refreshQueueSize]);

  const enqueue = useCallback(async (data: Record<string, string>, photos: File[] = []) => {
    const authState = usePublicAuthStore.getState();
    const consent = readStoredConsent();
    const item: QueuedReport = {
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      data,
      photos: photos.map((p) => p),
      photoNames: photos.map((p, i) => p.name || `offline-photo-${i + 1}.jpg`),
      created_at: now(),
      updated_at: now(),
      last_attempt_at: null,
      attempt_count: 0,
      // Persist the creator's public-user identity with the payload so delayed sync still credits the
      // contributor who captured the report, even if device auth changes before reconnect.
      owner_user_id: authState.user?.id || null,
      owner_email: authState.user?.email || null,
      auth_token: authState.token || localStorage.getItem(PUBLIC_AUTH_TOKEN_KEY),
      consent_choice: consent?.choice || null,
      consent_version: consent?.version || null,
      status: 'queued',
      error_message: null,
      expires_at: buildExpiry(UNSENT_RETENTION_DAYS),
      cleanup_at: null,
      next_retry_at: null,
    };
    await idbPut(item);
    void refreshQueueSize().catch(() => {});
    triggerBackgroundSyncIfPossible();
  }, [refreshQueueSize]);

  const clearQueue = useCallback(async () => {
    await idbClear();
    await refreshQueueSize();
  }, [refreshQueueSize]);

  const getQueue = useCallback(async (): Promise<QueuedReport[]> => {
    await cleanupQueue();
    return idbGetAll();
  }, [cleanupQueue]);

  const deleteItem = useCallback(async (id: string) => {
    await idbDelete(id);
    await refreshQueueSize();
  }, [refreshQueueSize]);

  const claimItem = useCallback(async (id: string) => {
    const authState = usePublicAuthStore.getState();
    const items = await idbGetAll();
    const item = items.find((entry) => entry.id === id);
    if (!item || !authState.user) return;
    await idbPut({
      ...item,
      owner_user_id: authState.user.id,
      owner_email: authState.user.email,
      auth_token: authState.token || localStorage.getItem(PUBLIC_AUTH_TOKEN_KEY),
      updated_at: now(),
    });
    await refreshQueueSize();
  }, [refreshQueueSize]);

  const retryItem = useCallback(async (id: string) => {
    const items = await idbGetAll();
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    await idbPut({
      ...item,
      status: 'queued',
      error_message: null,
      updated_at: now(),
      next_retry_at: null,
    });
    await refreshQueueSize();
    triggerBackgroundSyncIfPossible();
  }, [refreshQueueSize]);

  const syncQueue = useCallback(async (): Promise<number> => {
    if (syncInFlight) return syncInFlight;
    syncInFlight = (async () => {
    if (!navigator.onLine) return 0;
    const queue = await idbGetAll();
    const syncableItems = queue.filter((item) => !isExpired(item) && (isAutoRetryStatus(item.status) || isStaleSyncing(item)) && canRetryNow(item));
    if (!syncableItems.length) return 0;

    let synced = 0;

    // Replay sequentially so the server sees the same ordering the reporter created offline and we
    // avoid concurrent retries turning one outage into duplicate submissions.
    for (const item of syncableItems) {
      const startedAttempt = {
        ...item,
        status: 'syncing' as const,
        attempt_count: item.attempt_count + 1,
        last_attempt_at: now(),
        updated_at: now(),
      };
      await idbPut(startedAttempt);

      try {
        await submitQueuedItem(startedAttempt);
        synced += 1;
        await idbPut({
          ...startedAttempt,
          status: 'sent_confirmed',
          error_message: null,
          cleanup_at: buildExpiry(TOMBSTONE_RETENTION_DAYS),
          updated_at: now(),
          next_retry_at: null,
        });
      } catch (error) {
        const classified = error instanceof QueueSyncError
          ? error
          : new QueueSyncError(classifyQueueSyncFailure(undefined, summarizeError(error)));
        const nextRetryAt = classified.retryable ? now() + getRetryDelayMs(startedAttempt.attempt_count) : null;
        await idbPut({
          ...startedAttempt,
          status: classified.retryable ? 'failed_retryable' : 'failed_terminal',
          error_message: classified.retryable
            ? classified.message
            : `Manual action needed: ${classified.message}`,
          cleanup_at: null,
          updated_at: now(),
          next_retry_at: nextRetryAt,
        });
      }
    }

    await cleanupQueue();
    setLastSyncCount(synced);
    return synced;
    })();
    try {
      return await syncInFlight;
    } finally {
      syncInFlight = null;
    }
  }, [cleanupQueue]);

  useEffect(() => {
    if (!isOnline) return;
    const syncId = scheduleTask(() => {
      syncQueue().catch(() => {});
    });
    return () => window.clearTimeout(syncId);
  }, [isOnline, syncQueue]);

  useEffect(() => {
    const authState = usePublicAuthStore.getState();
    if (!authState.isAuthenticated) return;
    const syncId = scheduleTask(() => {
      syncQueue().catch(() => {});
    });
    return () => window.clearTimeout(syncId);
  }, [syncQueue]);

  return {
    isOnline,
    queueSize,
    lastSyncCount,
    enqueue,
    clearQueue,
    getQueue,
    syncQueue,
    cleanupQueue,
    deleteItem,
    claimItem,
    retryItem,
  };
}
