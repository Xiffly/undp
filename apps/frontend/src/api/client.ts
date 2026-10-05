import axios from 'axios';
import type {
  Report,
  Stats,
  ContributorProfile,
  PublicUserProfile,
  HomeContentResponse,
  SiteContentEntry,
  NewsArticle,
  FootprintFeatureCollection,
  FootprintSetSummary,
} from '../types';
import { useAuthStore } from '../store/auth';
import { usePublicAuthStore } from '../store/publicAuth';
import i18n from '../i18n';
import { readStoredConsent, type ConsentChoice } from '../consent/storage';

const API_BASE = import.meta.env.VITE_API_URL || '';
const FOREGROUND_REPORT_SUBMIT_TIMEOUT_MS = 3500;
const AI_CLASSIFICATION_REQUEST_TIMEOUT_MS = 240000;

function getCurrentLanguageCode() {
  return (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
}

function freshContentParams(params: Record<string, unknown>) {
  return { ...params, _ts: Date.now() };
}

type AuthMode = 'admin' | 'public';

function isAdminRoute() {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
}

function createApiClient(authMode?: AuthMode) {
  const instance = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    withCredentials: authMode !== 'public',
  });

  instance.interceptors.request.use((config) => {
    const consent = readStoredConsent();
    if (consent) {
      config.headers['X-Consent-Choice'] = consent.choice;
      config.headers['X-Consent-Version'] = consent.version;
    }
    if (!authMode) {
      return config;
    }
    const token = authMode === 'public' ? usePublicAuthStore.getState().token : null;
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  if (!authMode) return instance;

  instance.interceptors.response.use(
    (response) => response,
    (err) => {
      if (err.response?.status === 401) {
        if (authMode === 'admin') {
          useAuthStore.getState().clearAuth();
          if (isAdminRoute()) {
            window.location.href = '/admin/login';
          }
        } else {
          usePublicAuthStore.getState().logout();
        }
      }
      return Promise.reject(err);
    }
  );

  return instance;
}

const anonymousClient = createApiClient();
const publicClient = createApiClient('public');
const adminClient = createApiClient('admin');

export type ReportMapStats = {
  total: number;
  destroyed: number;
  partial: number;
  minimal: number;
  urgent: number;
  pending: number;
  verified: number;
  flagged: number;
  duplicate: number;
  rejected: number;
};

export type AdminUserScope = 'staff' | 'public' | 'all';

export type AdminUserIdentitySummary = {
  phone: string | null;
  verified_phone?: string | null;
  pending_phone?: string | null;
  phone_verified: boolean;
  linked_contributor_key: string | null;
  verification_pending: boolean;
  verification_nonce?: string | null;
  verification_expires_at?: string | null;
  contributor?: {
    primary_badge?: string | null;
    trust_score?: number;
    points_total?: number;
    reports_verified?: number;
    reports_submitted?: number;
  } | null;
  last_whatsapp_activity_at?: string | null;
};

export type AdminUserListItem = PublicUserProfile & {
  active?: boolean | number;
  identity?: AdminUserIdentitySummary;
};

type IdentityConflictRecord = Record<string, unknown>;
type TranslationAuditRecord = Record<string, unknown>;
type TranslationLocale = Record<string, unknown>;
type GenericApiResponse = Record<string, unknown>;
type ConsentConfigResponse = {
  consent_version: string;
  privacy_policy_url: string;
  governance_policy_url: string;
  banner_enabled: boolean;
};
type UserDetailResponse = { user: AdminUserListItem };
type TranslationStateResponse = { locale: TranslationLocale; staleKeys: string[]; missingKeys: string[] };
type StartPhoneVerificationResponse = { nonce?: string | null; instructions?: string | null; success?: boolean };
type CompletePhoneVerificationResponse = { success?: boolean; message?: string };
type StaffCreateResponse = { success?: boolean; user?: AdminUserListItem };
type AiStatusResponse = { features?: { sitrep?: boolean; [key: string]: unknown }; [key: string]: unknown };
export type ClassificationJobState = 'pending' | 'processing' | 'retry_wait' | 'completed' | 'failed_terminal';
export type ClassificationStatusResponse = {
  success?: boolean;
  report_id: string;
  status: 'missing' | ClassificationJobState;
  classification?: Report['ai_classification'] | null;
  job?: {
    status?: ClassificationJobState;
    last_error_code?: string | null;
    last_error_message?: string | null;
  } | null;
};

const ACTOR_KEY_STORAGE = 'public_actor_key';
const ACTOR_KEY_SESSION_STORAGE = 'public_actor_key_session';

function getStoredConsentChoice(): ConsentChoice | null {
  return readStoredConsent()?.choice || null;
}

export function getPublicActorKey() {
  const consentChoice = getStoredConsentChoice();
  if (consentChoice === 'decline') {
    const existingSessionKey = sessionStorage.getItem(ACTOR_KEY_SESSION_STORAGE);
    if (existingSessionKey) return existingSessionKey;
    const nextSessionKey = `actor_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    sessionStorage.setItem(ACTOR_KEY_SESSION_STORAGE, nextSessionKey);
    return nextSessionKey;
  }

  const existing = localStorage.getItem(ACTOR_KEY_STORAGE);
  if (existing) return existing;
  const next = `actor_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  localStorage.setItem(ACTOR_KEY_STORAGE, next);
  return next;
}

function getDownloadFilename(contentDisposition?: string, fallback = 'download') {
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition || '');
  if (!match) return fallback;
  return decodeURIComponent(match[1].replace(/"/g, '').trim());
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export const api = {
  getConsentConfig: () =>
    anonymousClient.get<ConsentConfigResponse>('/api/consent/config').then((response) => response.data),

  getReports: (params?: Record<string, string>) =>
    anonymousClient.get<{ reports: Report[]; total: number; limit: number; offset: number }>('/api/reports', { params }).then((response) => response.data),

  getReportStats: (params?: Record<string, string>) =>
    anonymousClient.get<ReportMapStats>('/api/reports/stats', { params }).then((response) => response.data),

  getReport: (id: string) => {
    const lang = getCurrentLanguageCode();
    return anonymousClient.get<Report>(`/api/reports/${id}`, { params: { lang } }).then((response) => response.data);
  },

  submitReport: (formData: FormData, signal?: AbortSignal) =>
    publicClient.post<{ success: boolean; report: Report; contributor?: Report['contributor']; moderation?: { flags: string[]; review_required: boolean } }>(
      '/api/reports',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: FOREGROUND_REPORT_SUBMIT_TIMEOUT_MS,
        signal,
      }
    ).then((response) => response.data),

  confirmReport: (id: string) =>
    anonymousClient.post(
      `/api/reports/${id}/confirm`,
      getStoredConsentChoice() === 'decline' ? {} : { actor_key: getPublicActorKey() }
    ).then((response) => response.data),

  adminLogin: (email: string, password: string) =>
    anonymousClient.post<{ expiresIn: number }>('/api/admin/login', { email, password }).then((response) => response.data),

  getStats: () =>
    adminClient.get<Stats>('/api/admin/stats').then((response) => response.data),

  getIdentityConflicts: () =>
    adminClient.get<{ conflicts: IdentityConflictRecord[]; total: number }>('/api/admin/identity-links').then((response) => response.data),

  manualLinkIdentity: (userId: string, contributor_key: string, reason: string) =>
    adminClient.post(`/api/admin/identity-links/${userId}/link`, { contributor_key, reason }).then((response) => response.data),

  mergeContributorProfiles: (targetKey: string, source_contributor_key: string, reason: string) =>
    adminClient.post(`/api/admin/contributors/${targetKey}/merge`, { source_contributor_key, reason }).then((response) => response.data),

  adminVerifyUserPhone: (userId: string, phone: string, reason: string) =>
    adminClient.post(`/api/admin/users/${userId}/phone-verification`, { phone, reason }).then((response) => response.data),

  repairReportMedia: () =>
    adminClient.post<{ success: boolean; reports_scanned: number; normalized: number; ai_failed_normalized: number; unresolved: number }>('/api/admin/media/repair').then((response) => response.data),

  getTranslationAudit: () =>
    adminClient.get<{
      report_issue_count: number;
      translation_issue_count: number;
      report_issues: TranslationAuditRecord[];
      translation_issues: TranslationAuditRecord[];
    }>('/api/admin/translation-audit').then((response) => response.data),

  getAdminReports: (params?: Record<string, string>) =>
    adminClient.get<{ reports: Report[]; total: number; limit: number; offset: number }>('/api/admin/reports', {
      params: { target_lang: getCurrentLanguageCode(), ...(params || {}) },
    }).then((response) => response.data),

  getAdminReportStats: (params?: Record<string, string>) =>
    adminClient.get<ReportMapStats>('/api/admin/reports/stats', { params }).then((response) => response.data),

  getAdminReport: (id: string, params?: Record<string, string>) =>
    adminClient.get<Report>(`/api/admin/reports/${id}`, {
      params: { target_lang: getCurrentLanguageCode(), ...(params || {}) },
    }).then((response) => response.data),

  updateReport: (id: string, data: Record<string, unknown>) =>
    adminClient.patch<Report>(`/api/reports/${id}`, data).then((response) => response.data),

  deleteReport: (id: string) =>
    adminClient.delete(`/api/reports/${id}`).then((response) => response.data),

  bulkUpdate: (ids: string[], status: string) =>
    adminClient.patch('/api/admin/reports/bulk', { ids, status }).then((response) => response.data),

  exportData: async (params: Record<string, string>) => {
    const response = await adminClient.get<Blob>('/api/export', {
      params: { target_lang: getCurrentLanguageCode(), ...params },
      responseType: 'blob',
    });
    const fallbackName = `crisis-data.${params.format || 'json'}`;
    const filename = getDownloadFilename(response.headers['content-disposition'], fallbackName);
    triggerBrowserDownload(response.data, filename);
  },

  getExportCount: (params?: Record<string, string>) =>
    adminClient.get<{ count: number }>('/api/export/count', { params }).then((response) => response.data),

  userLogin: (email: string, password: string) =>
    anonymousClient.post<{ token: string; user: PublicUserProfile }>('/api/users/login', { email, password }).then((response) => response.data),

  forgotPassword: (email: string) =>
    anonymousClient.post<{ success: boolean; message: string }>('/api/users/forgot-password', { email }).then((response) => response.data),

  resetPassword: (token: string, new_password: string) =>
    anonymousClient.post<{ success: boolean; message: string }>('/api/users/reset-password', { token, new_password }).then((response) => response.data),

  getMe: (authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).get<PublicUserProfile>('/api/users/me').then((response) => response.data),

  getMyIdentity: (authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).get<AdminUserIdentitySummary>('/api/users/me/identity').then((response) => response.data),

  updateMe: (data: Record<string, string>, authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).patch<{ success: boolean; user: PublicUserProfile }>('/api/users/me', data).then((response) => response.data),

  startPhoneVerification: (phone: string, authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).post<StartPhoneVerificationResponse>('/api/users/me/phone-verification/start', { phone }).then((response) => response.data),

  completePhoneVerification: (nonce: string, authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).post<CompletePhoneVerificationResponse>('/api/users/me/phone-verification/complete', { nonce }).then((response) => response.data),

  deletePhoneVerification: (authMode: AuthMode = 'public') =>
    (authMode === 'admin' ? adminClient : publicClient).delete<CompletePhoneVerificationResponse>('/api/users/me/phone-verification').then((response) => response.data),

  registerUser: (data: Record<string, string>) =>
    anonymousClient.post<{ success: boolean; token: string; user: PublicUserProfile }>('/api/users/register', data).then((response) => response.data),

  uploadMyAvatar: (file: File) => {
    const formData = new FormData();
    formData.append('avatar', file);
    return publicClient.post<{ success: boolean; user: PublicUserProfile }>('/api/users/me/avatar', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) => response.data);
  },

  deleteMyAvatar: () =>
    publicClient.delete<{ success: boolean; user: PublicUserProfile }>('/api/users/me/avatar').then((response) => response.data),

  createStaffUser: (data: Record<string, string>) =>
    adminClient.post<StaffCreateResponse>('/api/users/admin-create', data).then((response) => response.data),

  getUsers: (params?: { scope?: AdminUserScope }) =>
    adminClient.get<{ users: AdminUserListItem[]; total: number }>('/api/users', { params }).then((response) => response.data),

  getUserDetail: (id: string) =>
    adminClient.get<UserDetailResponse>(`/api/users/${id}`).then((response) => response.data),

  updateUser: (id: string, data: Record<string, unknown>) =>
    adminClient.patch<UserDetailResponse>(`/api/users/${id}`, data).then((response) => response.data),

  deactivateUser: (id: string) =>
    adminClient.patch(`/api/users/${id}/deactivate`).then((response) => response.data),

  activateUser: (id: string) =>
    adminClient.patch(`/api/users/${id}/activate`).then((response) => response.data),

  getContributors: (params?: Record<string, string>) =>
    adminClient.get<{ contributors: ContributorProfile[]; total: number; limit: number; offset: number }>('/api/contributors', { params }).then((response) => response.data),

  getContributorDetail: (key: string) =>
    adminClient.get<unknown>(`/api/contributors/${key}`).then((response) => response.data),

  recomputeAllContributors: () =>
    adminClient.post<{ success: boolean; recomputed: number }>('/api/contributors/recompute-all').then((response) => response.data),

  getContributorSettings: () =>
    adminClient.get<{ settings: Record<string, number> }>('/api/contributors/settings').then((response) => response.data),

  saveContributorSettings: (settings: Record<string, unknown>) =>
    adminClient.patch<{ success: boolean; settings: Record<string, number> }>('/api/contributors/settings', settings).then((response) => response.data),

  grantManualContributorBadge: (key: string, badge_code: string, reason: string) =>
    adminClient.post(`/api/contributors/${key}/manual-awards`, { badge_code, reason, awarded_by: 'admin' }).then((response) => response.data),

  revokeManualContributorBadge: (key: string, badgeCode: string) =>
    adminClient.delete(`/api/contributors/${key}/manual-awards/${badgeCode}`).then((response) => response.data),

  openPdfReport: (params?: Record<string, string>) => {
    const query = new URLSearchParams(params || {}).toString();
    window.open(`/api/pdf${query ? `?${query}` : ''}`, '_blank');
  },

  testAlert: () =>
    adminClient.get<{ status: string; message: string }>('/api/alerts/test').then((response) => response.data),

  getFormFields: (crisisEventId = 'default') =>
    adminClient.get<unknown>(`/api/form-builder/${crisisEventId}`).then((response) => response.data),

  getPublicFormFields: (crisisEventId = 'default', lang = getCurrentLanguageCode()) =>
    anonymousClient.get<unknown>(`/api/form-builder/${crisisEventId}/public`, { params: { lang } }).then((response) => response.data),

  getFootprints: (crisisEventId = 'default') =>
    adminClient.get<{ footprints: FootprintSetSummary[] }>(`/api/footprints/${crisisEventId}`).then((response) => response.data),

  getPublicFootprints: (crisisEventId = 'default') =>
    anonymousClient.get<FootprintFeatureCollection>(`/api/footprints/${crisisEventId}/public`).then((response) => response.data),

  uploadFootprint: (crisisEventId: string, formData: FormData) =>
    adminClient.post<{ footprint: FootprintSetSummary; message: string }>(`/api/footprints/${crisisEventId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((response) => response.data),

  updateFootprint: (crisisEventId: string, footprintId: string, data: Record<string, unknown>) =>
    adminClient.patch<{ footprint: FootprintSetSummary }>(`/api/footprints/${crisisEventId}/${footprintId}`, data).then((response) => response.data),

  deleteFootprint: (crisisEventId: string, footprintId: string) =>
    adminClient.delete<{ success: boolean }>(`/api/footprints/${crisisEventId}/${footprintId}`).then((response) => response.data),

  createFormField: (crisisEventId: string, data: Record<string, unknown>) =>
    adminClient.post<unknown>(`/api/form-builder/${crisisEventId}/fields`, data).then((response) => response.data),

  updateFormField: (crisisEventId: string, fieldId: string, data: Record<string, unknown>) =>
    adminClient.patch<unknown>(`/api/form-builder/${crisisEventId}/${fieldId}`, data).then((response) => response.data),

  deleteFormField: (crisisEventId: string, fieldId: string) =>
    adminClient.delete<unknown>(`/api/form-builder/${crisisEventId}/${fieldId}`).then((response) => response.data),

  updateFormSection: (crisisEventId: string, sectionKey: string, data: Record<string, unknown>) =>
    adminClient.patch<unknown>(`/api/form-builder/${crisisEventId}/sections/${sectionKey}`, data).then((response) => response.data),

  getTranslations: (lang: string) =>
    adminClient.get<TranslationStateResponse>(`/api/form-builder/translations/${lang}`).then((response) => response.data),

  saveTranslations: (lang: string, data: Record<string, unknown>) =>
    adminClient.put<{ success: boolean }>(`/api/form-builder/translations/${lang}`, data).then((response) => response.data),

  saveTranslationKey: (lang: string, key: string, value: string) =>
    adminClient.patch<{ success: boolean; key: string; value: string }>(`/api/form-builder/translations/${lang}/key`, { key, value }).then((response) => response.data),

  getTranslationStatus: () =>
    adminClient.get<unknown>('/api/form-builder/translations').then((response) => response.data),

  runAutoTranslate: (lang: string) =>
    adminClient.post<{ success: boolean; updated: number; total: number; provider: string; model: string; note?: string }>(`/api/form-builder/translations/${lang}/auto-translate`).then((response) => response.data),

  runAutoTranslateKey: (lang: string, key: string) =>
    adminClient.post<{ success: boolean; key: string; source: string; value: string; provider: string; model: string; note?: string }>(
      `/api/form-builder/translations/${lang}/auto-translate-key`,
      { key }
    ).then((response) => response.data),

  getHomeContent: (lang = getCurrentLanguageCode()) =>
    adminClient.get<HomeContentResponse>('/api/content/home', { params: freshContentParams({ lang }) }).then((response) => response.data),

  getPublicHomeContent: () =>
    anonymousClient.get<HomeContentResponse>('/api/public/home', { params: freshContentParams({ lang: getCurrentLanguageCode() }) }).then((response) => response.data),

  updateHomeSection: (key: string, data: Partial<SiteContentEntry>, lang = getCurrentLanguageCode()) =>
    adminClient.patch<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}`, data, { params: { lang } }).then((response) => response.data),

  reviewHomeSection: (key: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}/review`, null, { params: { lang } }).then((response) => response.data),

  publishHomeSection: (key: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}/publish`, null, { params: { lang } }).then((response) => response.data),

  publishHomePage: (lang = getCurrentLanguageCode()) =>
    adminClient.post<HomeContentResponse>('/api/content/home/publish-page', null, { params: { lang } }).then((response) => response.data),

  copyHomeSectionFromSource: (key: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}/copy-from-source`, null, { params: { lang } }).then((response) => response.data),

  reorderHomeSections: (order: { key: string; sort_order: number }[], lang = getCurrentLanguageCode()) =>
    adminClient.patch<HomeContentResponse>('/api/content/home/reorder', { order }, { params: { lang } }).then((response) => response.data),

  updateHomeSectionVisibility: (key: string, is_enabled: boolean, lang = getCurrentLanguageCode()) =>
    adminClient.patch<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}/visibility`, { is_enabled }, { params: { lang } }).then((response) => response.data),

  restoreHomeSection: (key: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<HomeContentResponse>(`/api/content/home/${encodeURIComponent(key)}/restore`, null, { params: { lang } }).then((response) => response.data),

  getNewsArticles: (lang = getCurrentLanguageCode()) =>
    adminClient.get<{ requested_lang: string; articles: NewsArticle[] }>('/api/content/news', { params: freshContentParams({ lang }) }).then((response) => response.data),

  getNewsArticle: (id: string, lang = getCurrentLanguageCode()) =>
    adminClient.get<{ article: NewsArticle }>(`/api/content/news/${id}`, { params: freshContentParams({ lang }) }).then((response) => response.data),

  getPublicNewsArticles: () =>
    anonymousClient.get<{ requested_lang: string; articles: NewsArticle[] }>('/api/public/news', { params: freshContentParams({ lang: getCurrentLanguageCode() }) }).then((response) => response.data),

  getPublicNewsArticle: (slug: string) =>
    anonymousClient.get<{ article: NewsArticle }>(`/api/public/news/${slug}`, { params: freshContentParams({ lang: getCurrentLanguageCode() }) }).then((response) => response.data),

  createNewsArticle: (data: Partial<NewsArticle>) =>
    adminClient.post<{ article: NewsArticle }>('/api/content/news', data).then((response) => response.data),

  updateNewsArticle: (id: string, data: Partial<NewsArticle>, lang = getCurrentLanguageCode()) =>
    adminClient.patch<{ article: NewsArticle }>(`/api/content/news/${id}`, data, { params: { lang } }).then((response) => response.data),

  reviewNewsArticle: (id: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<{ requested_lang: string; articles: NewsArticle[] }>(`/api/content/news/${id}/review`, null, { params: { lang } }).then((response) => response.data),

  publishNewsArticle: (id: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<{ requested_lang: string; articles: NewsArticle[] }>(`/api/content/news/${id}/publish`, null, { params: { lang } }).then((response) => response.data),

  copyNewsArticleFromSource: (id: string, lang = getCurrentLanguageCode()) =>
    adminClient.post<{ requested_lang: string; articles: NewsArticle[] }>(`/api/content/news/${id}/copy-from-source`, null, { params: { lang } }).then((response) => response.data),

  deleteNewsArticle: (id: string) =>
    adminClient.delete<{ success: boolean }>(`/api/content/news/${id}`).then((response) => response.data),

  uploadNewsFeaturedImage: (id: string, file: File, lang = getCurrentLanguageCode()) => {
    const formData = new FormData();
    formData.append('image', file);
    return adminClient.post<{ article: NewsArticle }>(`/api/content/news/${id}/featured-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { lang },
    }).then((response) => response.data);
  },

  getAiStatus: () =>
    adminClient.get<AiStatusResponse>('/api/ai/status').then((response) => response.data),

  getAiSettings: () =>
    adminClient.get<{ settings: Record<string, string> }>('/api/ai/settings').then((response) => response.data),

  getAiModels: () =>
    adminClient.get<{ models: { vision: string[]; text: string[]; translation: string[] }; source: string; provider: string }>('/api/ai/models').then((response) => response.data),

  saveAiSettings: (settings: Record<string, string>) =>
    adminClient.patch<{ success: boolean; updated: string[] }>('/api/ai/settings', settings).then((response) => response.data),

  classifyDamage: (reportId: string) =>
    adminClient.post<ClassificationStatusResponse>('/api/ai/classify-damage', { reportId }, {
      timeout: AI_CLASSIFICATION_REQUEST_TIMEOUT_MS,
    }).then((response) => response.data),

  getClassificationStatus: (reportId: string) =>
    adminClient.get<ClassificationStatusResponse>(`/api/ai/classify-damage/${reportId}`).then((response) => response.data),

  generateSitrep: (params: { bbox?: string; crisis_event?: string; since?: string; focus_area?: string }) =>
    adminClient.post<unknown>('/api/ai/sitrep', params, {
      timeout: 120000,
    }).then((response) => response.data),

  getSitrepHistory: () =>
    adminClient.get<unknown>('/api/ai/sitrep-history', {
      params: { ts: Date.now() },
      headers: { 'Cache-Control': 'no-cache' },
    }).then((response) => response.data),

  getSitrepDetail: (id: string) =>
    adminClient.get<unknown>(`/api/ai/sitrep-history/${id}`, {
      params: { lang: getCurrentLanguageCode() },
    }).then((response) => response.data),

  getReportSettings: () =>
    adminClient.get<{ settings: Record<string, string> }>('/api/admin/report-settings').then((response) => response.data),

  saveReportSettings: (settings: Record<string, string>) =>
    adminClient.patch<{ success: boolean; updated: string[] }>('/api/admin/report-settings', settings).then((response) => response.data),

  scanReportDuplicates: (params: { radius_m?: number; time_hours?: number; auto_flag?: boolean }) =>
    adminClient.post<GenericApiResponse>('/api/admin/report-settings/detect-duplicates', params).then((response) => response.data),

  reverseGeocodeReportLocation: (params: { lat: number; lng: number }) =>
    adminClient.post<{ success: boolean; address_text?: string | null; provider: string; resolved_lat: number; resolved_lng: number; address: Record<string, string> }>(
      '/api/admin/reports/reverse-geocode',
      params
    ).then((response) => response.data),
};
