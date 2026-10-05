import { createFallbackSections, hasLocationInput, isCustomFieldKey, parseCoordinate, emptyForm, PublicFormSection, DEFAULT_SECTION_DEFS, FIELD_SECTION_MAP, FormFieldKey, hasValidCoordinates, PublicFormField } from '../components/submit/formModel';
import { LocationPicker, MapFlyTo, AddressAutocomplete } from '../components/submit/LocationInputs';
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import { AlertTriangle, Camera, CheckCircle, Loader2, MapPin, WifiOff, X } from 'lucide-react';
import { api } from '../api/client';
import { getPublicActorKey } from '../api/client';
import { useConsent } from '../consent/useConsent';
import { useGeolocation } from '../hooks/useGeolocation';
import { compressImages } from '../utils/imageCompression';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { usePublicAuthStore } from '../store/publicAuth';
import BuildingFootprintLayer from '../components/BuildingFootprintLayer';
import { CRISIS_TYPES, DAMAGE_LEVELS, ELECTRICITY_CONDITIONS, HEALTH_SERVICES, INFRA_CATEGORIES, PRESSING_NEEDS } from '../types';
import { getFootprintLabelFromProperties } from '../utils/footprints';

type LeafletIconDefaults = typeof L.Icon.Default.prototype & {
  _getIconUrl?: () => string;
};

delete (L.Icon.Default.prototype as LeafletIconDefaults)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type FormFieldVisibility = Record<string, boolean>;

const DEFAULT_FIELD_VISIBILITY: FormFieldVisibility = {
  f_location: true,
  f_infra_category: true,
  f_infra_name: true,
  f_crisis_type: true,
  f_debris: true,
  f_damage_level: true,
  f_electricity: true,
  f_health: true,
  f_pressing_needs: true,
  f_description: true,
  f_photos: true,
};

type StepId = PublicFormSection['key'];
type CustomFieldValue = string | string[] | boolean;

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function getApiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (error instanceof Error ? error.message : fallback);
}

function isQuotaExceededError(error: unknown) {
  const message = String((error as Error | null)?.message || '').toLowerCase();
  const name = String((error as Error | null)?.name || '').toLowerCase();
  return name.includes('quotaexceeded') || message.includes('quota exceeded');
}

function isLikelyOfflineSubmitFailure(error: unknown): boolean {
  const maybeAxios = error as {
    response?: unknown;
    code?: string;
    message?: string;
  } | null;
  if (maybeAxios?.response) return false;
  const code = String(maybeAxios?.code || '').toUpperCase();
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED' || code === 'ERR_CANCELED') return true;
  const message = String(maybeAxios?.message || '').toLowerCase();
  return message.includes('network error')
    || message.includes('failed to fetch')
    || message.includes('load failed')
    || message.includes('timeout')
    || message.includes('queue fallback');
}

function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

const FOREGROUND_SUBMIT_FALLBACK_MS = 2500;

async function submitReportWithForegroundDeadline(payload: FormData) {
  const controller = new AbortController();
  let timeoutId: number | undefined;

  try {
    const submitPromise = api.submitReport(payload, controller.signal);
    const deadlinePromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => {
        controller.abort();
        const timeoutError = new Error('Queue fallback deadline reached');
        (timeoutError as Error & { code?: string }).code = 'ERR_CANCELED';
        reject(timeoutError);
      }, FOREGROUND_SUBMIT_FALLBACK_MS);
    });

    return await Promise.race([submitPromise, deadlinePromise]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

function crisisGroupKey(group: string): string {
  if (group === 'Natural Hazards') return 'submit.crisis_natural';
  if (group === 'Technological / Industrial') return 'submit.crisis_tech';
  if (group === 'Human-made') return 'submit.crisis_human';
  return group;
}

function damageCardClasses(id: string) {
  if (id === 'destroyed') {
    return {
      border: 'border-red-400',
      background: 'bg-red-50',
      text: 'text-red-700',
    };
  }
  if (id === 'partial') {
    return {
      border: 'border-orange-400',
      background: 'bg-orange-50',
      text: 'text-orange-700',
    };
  }
  return {
    border: 'border-green-400',
    background: 'bg-green-50',
    text: 'text-green-700',
  };
}

export default function Submit() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { hasRequiredConsent, allowsPersistentIdentity } = useConsent();
  const { lat: gpsLat, lng: gpsLng, loading: gpsLoading, error: gpsError, getLocation } = useGeolocation();
  const { isOnline, queueSize, enqueue } = useOfflineQueue();
  const publicUser = usePublicAuthStore((state) => state.user);

  const [step, setStep] = useState(0);
  const [fieldVisibility, setFieldVisibility] = useState<FormFieldVisibility>(DEFAULT_FIELD_VISIBILITY);
  const [sections, setSections] = useState<PublicFormSection[]>(createFallbackSections());
  const [form, setForm] = useState(emptyForm);
  const [customFields, setCustomFields] = useState<Record<string, CustomFieldValue>>({});
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [compressing, setCompressing] = useState(false);
  const [photoSizes, setPhotoSizes] = useState<{ compressed: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [footprintStatus, setFootprintStatus] = useState({ loading: false, available: false, count: 0, error: false });

  const set = useCallback((key: string, value: string | string[] | boolean | number) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);
  const clearFootprintSelection = useCallback(() => {
    setForm((current) => ({
      ...current,
      location_capture_mode: current.location_capture_mode === 'footprint' ? 'map' : current.location_capture_mode,
      building_label: '',
      footprint_set_id: '',
      footprint_feature_id: '',
      footprint_feature_key: '',
    }));
  }, []);
  const setFreeformLocation = useCallback((lat: number, lng: number, mode: string) => {
    setForm((current) => ({
      ...current,
      lat,
      lng,
      location_capture_mode: mode,
      building_label: '',
      footprint_set_id: '',
      footprint_feature_id: '',
      footprint_feature_key: '',
    }));
  }, []);
  const setFootprintLocation = useCallback(
    (selection: {
      lat: number;
      lng: number;
      label?: string;
      footprint_set_id: string;
      footprint_feature_id: string;
      footprint_feature_key: string;
    }) => {
      setForm((current) => ({
        ...current,
        lat: selection.lat,
        lng: selection.lng,
        location_capture_mode: 'footprint',
        building_label: selection.label || '',
        footprint_set_id: selection.footprint_set_id,
        footprint_feature_id: selection.footprint_feature_id,
        footprint_feature_key: selection.footprint_feature_key,
      }));
    },
    []
  );

  const isFieldVisible = useCallback(
    (fieldKey: FormFieldKey) => fieldVisibility[fieldKey],
    [fieldVisibility]
  );
  const visibleSections = sections.filter((section) => section.enabled && section.fields.length > 0);
  const currentStepDef = visibleSections[Math.min(step, Math.max(visibleSections.length - 1, 0))] || sections[0] || DEFAULT_SECTION_DEFS[0];
  const currentStepId = currentStepDef.key;
  const currentStepFields = [...(currentStepDef.fields || [])]
    .filter((field) => field.enabled)
    .sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (!gpsLat || !gpsLng) return;
    const gpsId = scheduleTask(() => {
      setFreeformLocation(gpsLat, gpsLng, 'gps');
    });
    return () => window.clearTimeout(gpsId);
  }, [gpsLat, gpsLng, setFreeformLocation]);

  useEffect(() => {
    let cancelled = false;

    const loadFieldVisibility = async () => {
      try {
        const response = await api.getPublicFormFields('default', (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0]) as {
          sections?: PublicFormSection[];
          fields?: PublicFormField[];
        };
        if (cancelled) return;
        const nextVisibility = { ...DEFAULT_FIELD_VISIBILITY };
        const visibleKeys = new Set<FormFieldKey>();
        const nextSections = (response.sections?.length
          ? response.sections
          : DEFAULT_SECTION_DEFS.map((section) => ({
              ...section,
              fields: (response.fields as PublicFormField[])
                .filter((field) => FIELD_SECTION_MAP[(field.key || field.id.replace(/_default$/, '')) as FormFieldKey] === section.key),
            }))) as PublicFormSection[];

        for (const field of response.fields as PublicFormField[]) {
          const normalized = (field.key || field.id.replace(/_default$/, '')) as FormFieldKey;
          if (normalized in nextVisibility) {
            visibleKeys.add(normalized);
          }
        }

        (Object.keys(nextVisibility) as FormFieldKey[]).forEach((fieldKey) => {
          nextVisibility[fieldKey] = visibleKeys.has(fieldKey);
        });
        nextVisibility.f_location = true;
        nextVisibility.f_damage_level = true;
        setFieldVisibility(nextVisibility);
        const sortedSections = [...nextSections].sort((a, b) => {
          const aOrder = typeof a.order === 'number' ? a.order : DEFAULT_SECTION_DEFS.findIndex((section) => section.key === a.key) + 1;
          const bOrder = typeof b.order === 'number' ? b.order : DEFAULT_SECTION_DEFS.findIndex((section) => section.key === b.key) + 1;
          return aOrder - bOrder;
        });
        setSections(sortedSections);
        setCustomFields((current) => {
          const allowedCustomKeys = new Set<`custom_${string}`>(
            sortedSections
              .flatMap((section) => section.fields.map((field) => field.key))
              .filter((key): key is `custom_${string}` => isCustomFieldKey(key))
          );
          return Object.fromEntries(
            Object.entries(current).filter(
              (entry): entry is [`custom_${string}`, CustomFieldValue] =>
                isCustomFieldKey(entry[0]) && allowedCustomKeys.has(entry[0])
            )
          );
        });
      } catch {
        if (!cancelled) {
          setFieldVisibility(DEFAULT_FIELD_VISIBILITY);
          setSections(createFallbackSections());
        }
      }
    };

    const loadId = scheduleTask(() => {
      loadFieldVisibility().catch(() => {});
    });
    return () => {
      window.clearTimeout(loadId);
      cancelled = true;
    };
  }, [i18n.language, i18n.resolvedLanguage]);

  useEffect(() => {
    const pruneId = scheduleTask(() => {
      setForm((current) => ({
        ...current,
        infra_category: isFieldVisible('f_infra_category') ? current.infra_category : '',
        infra_name: isFieldVisible('f_infra_name') ? current.infra_name : '',
        crisis_type: isFieldVisible('f_crisis_type') ? current.crisis_type : '',
        has_debris: isFieldVisible('f_debris') ? current.has_debris : '',
        description: isFieldVisible('f_description') ? current.description : '',
        electricity_condition: isFieldVisible('f_electricity') ? current.electricity_condition : '',
        health_services: isFieldVisible('f_health') ? current.health_services : '',
        pressing_needs: isFieldVisible('f_pressing_needs') ? current.pressing_needs : [],
        pressing_needs_other: isFieldVisible('f_pressing_needs') ? current.pressing_needs_other : '',
      }));
      if (!isFieldVisible('f_photos')) {
        setPhotos([]);
        setPhotoPreviews([]);
        setPhotoSizes([]);
      }
    });
    return () => window.clearTimeout(pruneId);
  }, [isFieldVisible]);

  useEffect(() => {
    if (step >= visibleSections.length) {
      const stepId = scheduleTask(() => {
        setStep(Math.max(visibleSections.length - 1, 0));
      });
      return () => window.clearTimeout(stepId);
    }
  }, [step, visibleSections.length]);

  const toggleNeed = (id: string) => {
    set(
      'pressing_needs',
      form.pressing_needs.includes(id)
        ? form.pressing_needs.filter((item) => item !== id)
        : [...form.pressing_needs, id]
    );
  };

  const setCustomFieldValue = (key: string, value: CustomFieldValue) => {
    setCustomFields((current) => ({ ...current, [key]: value }));
  };

  const toggleCustomMultiValue = (key: string, value: string) => {
    setCustomFields((current) => {
      const existing = Array.isArray(current[key]) ? (current[key] as string[]) : [];
      return {
        ...current,
        [key]: existing.includes(value)
          ? existing.filter((item) => item !== value)
          : [...existing, value],
      };
    });
  };

  const handlePhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, 5 - photos.length);
    if (!files.length) return;

    setCompressing(true);
    try {
      const compressed = await compressImages(files);
      setPhotoSizes((current) => [...current, ...compressed.map((file) => ({ compressed: file.size }))]);
      setPhotos((current) => [...current, ...compressed]);
      const previews = await Promise.all(
        compressed.map(
          (file) =>
            new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(file);
            })
        )
      );
      setPhotoPreviews((current) => [...current, ...previews]);
    } finally {
      setCompressing(false);
    }
  };

  const removePhoto = (index: number) => {
    setPhotos((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPhotoPreviews((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPhotoSizes((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const validate = (currentStepId: StepId): boolean => {
    const nextErrors: Record<string, string> = {};
    const stepSection = visibleSections.find((section) => section.key === currentStepId);
    const fields = [...(stepSection?.fields || [])].filter((field) => field.enabled).sort((a, b) => a.order - b.order);

    for (const field of fields) {
      if (!field.required) continue;
      switch (field.key) {
        case 'f_location':
          if (!hasLocationInput(form)) nextErrors.location = t('submit.error_location');
          break;
        case 'f_infra_category':
          if (!form.infra_category) nextErrors.infra_category = t('submit.error_infra_category');
          break;
        case 'f_crisis_type':
          if (!form.crisis_type) nextErrors.crisis_type = t('submit.error_crisis_type');
          break;
        case 'f_damage_level':
          if (!form.damage_level) nextErrors.damage_level = t('submit.error_damage_level');
          break;
        case 'f_electricity':
          if (!form.electricity_condition) nextErrors.electricity_condition = t('submit.error_electricity');
          break;
        case 'f_health':
          if (!form.health_services) nextErrors.health_services = t('submit.error_health');
          break;
        case 'f_pressing_needs':
          if (form.pressing_needs.length === 0) nextErrors.pressing_needs = t('submit.error_needs');
          break;
        case 'f_photos':
          if (photos.length === 0) nextErrors.photos = t('submit.error_photos', { defaultValue: 'Please add at least one photo.' });
          break;
        default:
          if (field.key.startsWith('custom_')) {
            const value = customFields[field.key];
            const invalid = field.type === 'photo_upload'
              ? photos.length === 0
              : Array.isArray(value)
                ? value.length === 0
                : typeof value === 'boolean'
                  ? false
                  : !String(value || '').trim();
            if (invalid) {
              nextErrors[field.type === 'photo_upload' ? 'photos' : field.key] = t('submit.error_custom_required', { defaultValue: 'This field is required.' });
            }
          }
      }
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const next = () => {
    if (validate(currentStepId)) setStep((current) => current + 1);
  };

  const back = () => setStep((current) => current - 1);

  const submit = async () => {
    if (!hasRequiredConsent) {
      setErrors((current) => ({
        ...current,
        submit: t('consent.blocked_message', { defaultValue: 'Choose a privacy option to continue with account and reporting features.' }),
      }));
      return;
    }

    if (!validate(currentStepId)) return;

    setSubmitting(true);
    try {
      const payload = new FormData();
      if (hasValidCoordinates(form.lat, form.lng)) {
        payload.append('lat', String(form.lat));
        payload.append('lng', String(form.lng));
      }
      payload.append('address_text', form.address_text);
      if (form.building_label) payload.append('building_label', form.building_label);
      if (allowsPersistentIdentity) {
        payload.append('actor_key', getPublicActorKey());
      }
      payload.append('location_capture_mode', form.location_capture_mode || 'unknown');
      if (form.footprint_set_id) payload.append('footprint_set_id', form.footprint_set_id);
      if (form.footprint_feature_id) payload.append('footprint_feature_id', form.footprint_feature_id);
      if (form.footprint_feature_key) payload.append('footprint_feature_key', form.footprint_feature_key);
      if (isFieldVisible('f_infra_category')) payload.append('infra_category', form.infra_category);
      if (isFieldVisible('f_infra_name')) payload.append('infra_name', form.infra_name);
      if (isFieldVisible('f_crisis_type')) payload.append('crisis_type', form.crisis_type);
      payload.append('damage_level', form.damage_level);
      if (isFieldVisible('f_electricity')) payload.append('electricity_condition', form.electricity_condition);
      if (isFieldVisible('f_health')) payload.append('health_services', form.health_services);
      if (isFieldVisible('f_pressing_needs')) {
        payload.append(
          'pressing_needs',
          JSON.stringify(
            form.pressing_needs.includes('other') && form.pressing_needs_other
              ? [...form.pressing_needs.filter((item) => item !== 'other'), `other:${form.pressing_needs_other}`]
              : form.pressing_needs
          )
        );
      }
      if (isFieldVisible('f_debris')) payload.append('has_debris', form.has_debris);
      if (isFieldVisible('f_description')) payload.append('description', form.description);
      if (Object.keys(customFields).length > 0) payload.append('custom_fields', JSON.stringify(customFields));
      payload.append('is_urgent', String(form.is_urgent));
      payload.append('submitter_contact', form.submitter_contact);
      payload.append('source_language', currentLanguage.split('-')[0]);
      if (isFieldVisible('f_photos')) {
        photos.forEach((photo) => payload.append('photos', photo));
      }

      const offlineData: Record<string, string> = {};
      payload.forEach((value, key) => {
        if (typeof value === 'string') offlineData[key] = value;
      });

      const queueOfflineSubmission = async () => {
        // Store the exact API payload shape so background replay does not need to reconstruct business
        // rules from transient UI state after the user leaves this session.
        await enqueue(offlineData, photos);
        setSubmitting(false);
        navigate('/queue', {
          state: {
            queued: true,
            offline: true,
            queuedForAccount: Boolean(publicUser?.id),
            summary: {
              crisis_type: form.crisis_type,
              building_label: form.building_label,
              address_text: form.address_text,
              damage_level: form.damage_level,
              photo_count: photos.length,
            },
          },
        });
      };

      if (!isOnline || !isBrowserOnline()) {
        await queueOfflineSubmission();
        return;
      }

      try {
        const { report, contributor, moderation } = await submitReportWithForegroundDeadline(payload);
        navigate('/confirmation', {
          state: {
            reportId: report.id,
            contributor,
            moderation,
          },
        });
      } catch (error: unknown) {
        if (!isLikelyOfflineSubmitFailure(error)) throw error;
        // Store the exact API payload shape so background replay does not need to reconstruct business
        // rules from transient UI state after the user leaves this session. This also covers browsers
        // that still report navigator.onLine=true during a real connectivity outage.
        await queueOfflineSubmission();
      }
    } catch (error: unknown) {
      setErrors({
        submit: isQuotaExceededError(error)
          ? t('submit.error_storage_full', { defaultValue: 'This device storage is full for offline reports. Clear site data or reduce photos and try again.' })
          : getApiErrorMessage(error, t('submit.error_submit')),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const mapCenter: [number, number] = form.lat && form.lng ? [form.lat, form.lng] : [15.35, 44.2];
  const stepLabels = visibleSections.map((section) => section.title || t(section.label_key));
  const currentLanguage = i18n.resolvedLanguage || i18n.language || 'en';
  const selectedBuildingActive = Boolean(form.footprint_set_id && (form.footprint_feature_id || form.footprint_feature_key));

  const renderCustomField = (field: PublicFormField) => {
    const fieldError = errors[field.key];
    const customValue = customFields[field.key];

    if (field.type === 'photo_upload') {
      return null;
    }

    if (field.type === 'text') {
      return (
        <div key={field.id} className="mb-4">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            {field.label} {field.required && '*'}
          </label>
          <input
            type="text"
            value={typeof customValue === 'string' ? customValue : ''}
            onChange={(event) => setCustomFieldValue(field.key, event.target.value)}
            placeholder={field.placeholder || field.label}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
          />
          {fieldError && <p className="mt-1 text-xs text-red-500">{fieldError}</p>}
        </div>
      );
    }

    if (field.type === 'yesno') {
      const value = typeof customValue === 'string' ? customValue : '';
      return (
        <div key={field.id} className="mb-4">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            {field.label} {field.required && '*'}
          </label>
          <div className="flex gap-2">
            {[
              { id: 'yes', label: t('submit.debris_yes', { defaultValue: 'Yes' }) },
              { id: 'no', label: t('submit.debris_no', { defaultValue: 'No' }) },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setCustomFieldValue(field.key, option.id)}
                className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                  value === option.id
                    ? 'border-un-blue bg-un-light text-un-dark'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {fieldError && <p className="mt-1 text-xs text-red-500">{fieldError}</p>}
        </div>
      );
    }

    if (field.type === 'multi_select') {
      const values = Array.isArray(customValue) ? customValue : [];
      return (
        <div key={field.id} className="mb-4">
          <label className="mb-2 block text-sm font-semibold text-gray-700">
            {field.label} {field.required && '*'}
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {field.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => toggleCustomMultiValue(field.key, option.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                  values.includes(option.id)
                    ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                <div
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 ${
                    values.includes(option.id) ? 'border-un-blue bg-un-blue' : 'border-gray-300'
                  }`}
                >
                  {values.includes(option.id) && <span className="text-[10px] text-white">OK</span>}
                </div>
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          {fieldError && <p className="mt-1 text-xs text-red-500">{fieldError}</p>}
        </div>
      );
    }

    const value = typeof customValue === 'string' ? customValue : '';
    return (
      <div key={field.id} className="mb-4">
        <label className="mb-2 block text-sm font-semibold text-gray-700">
          {field.label} {field.required && '*'}
        </label>
        <div className="space-y-1.5">
          {field.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setCustomFieldValue(field.key, option.id)}
              className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                value === option.id
                  ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {value === option.id ? (
                <CheckCircle size={16} className="flex-shrink-0 text-un-blue" />
              ) : (
                <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-300" />
              )}
              {option.label}
            </button>
          ))}
        </div>
        {fieldError && <p className="mt-1 text-xs text-red-500">{fieldError}</p>}
      </div>
    );
  };

  const renderStepField = (field: PublicFormField) => {
    if (field.key.startsWith('custom_')) {
      return renderCustomField(field);
    }

    switch (field.key) {
      case 'f_location':
        return null;
      case 'f_infra_category':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id} className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {field.label || t('submit.infra_title_label')} {field.required && '*'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {INFRA_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => set('infra_category', category.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                    form.infra_category === category.id
                      ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-1.5">{category.emoji}</span>
                  {optionLabels[category.id] || t(`infra.${category.id}`, { defaultValue: category.label })}
                </button>
              ))}
            </div>
            {errors.infra_category && <p className="mt-1 text-xs text-red-500">{errors.infra_category}</p>}
          </div>
        );
        }
      case 'f_infra_name':
        return (
          <div key={field.id} className="mb-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">{field.label || t('submit.infra_name_label')}</label>
            <input
              type="text"
              value={form.infra_name}
              onChange={(event) => set('infra_name', event.target.value)}
              placeholder={field.placeholder || t('submit.infra_name_placeholder')}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
          </div>
        );
      case 'f_crisis_type':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id}>
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {field.label || t('submit.crisis_title_label')} {field.required && '*'}
            </label>
            <div className="space-y-2">
              {CRISIS_TYPES.map((group) => (
                <div key={group.group}>
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                    {t(crisisGroupKey(group.group), { defaultValue: group.group })}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.options.map((crisisType) => (
                      <button
                        key={crisisType.id}
                        type="button"
                        onClick={() => set('crisis_type', crisisType.id)}
                        className={`rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                          form.crisis_type === crisisType.id
                            ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                            : 'border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}
                        >
                          <span className="mr-1.5">{crisisType.emoji}</span>
                        {optionLabels[crisisType.id] || t(`crisis_types.${crisisType.id}`, { defaultValue: crisisType.label })}
                        </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {errors.crisis_type && <p className="mt-1 text-xs text-red-500">{errors.crisis_type}</p>}
          </div>
        );
        }
      case 'f_damage_level':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id} className="space-y-3">
            <label className="block text-sm font-semibold text-gray-700">
              {field.label || t('submit.damage_level_label')} {field.required && '*'}
            </label>
            <p className="text-sm text-gray-500">{t('submit.damage_subtitle')}</p>
            {DAMAGE_LEVELS.map((damage) => {
              const tone = damageCardClasses(damage.id);
              const selected = form.damage_level === damage.id;
              return (
                <button
                  key={damage.id}
                  type="button"
                  onClick={() => set('damage_level', damage.id)}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                    selected ? `${tone.border} ${tone.background}` : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className={`font-bold ${selected ? tone.text : 'text-gray-800'}`}>
                        {optionLabels[damage.id] || t(`damage.${damage.id}`, { defaultValue: damage.label })}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {t(`damage.${damage.id}_sub`, { defaultValue: damage.sublabel })}
                      </p>
                    </div>
                    {selected && <CheckCircle size={20} className={`ml-auto flex-shrink-0 ${tone.text}`} />}
                  </div>
                </button>
              );
            })}
            {errors.damage_level && <p className="mt-2 text-xs text-red-500">{errors.damage_level}</p>}
          </div>
        );
        }
      case 'f_debris':
        return (
          <div key={field.id} className="mt-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {field.label || t('submit.debris_title')} <span className="font-normal text-gray-400">{t('submit.description_optional')}</span>
            </label>
            <p className="mb-2 text-sm text-gray-500">{t('submit.debris_subtitle')}</p>
            <div className="flex gap-2">
              {(['yes', 'no', 'unknown'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => set('has_debris', value)}
                  className={`flex-1 rounded-xl border py-2 text-sm font-medium transition-all ${
                    form.has_debris === value
                      ? 'border-un-blue bg-un-light text-un-dark'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t(`submit.debris_${value}`)}
                </button>
              ))}
            </div>
          </div>
        );
      case 'f_description':
        return (
          <div key={field.id} className="mt-4">
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {field.label || t('submit.description_label')} <span className="font-normal text-gray-400">{t('submit.description_optional')}</span>
            </label>
            <textarea
              value={form.description}
              onChange={(event) => set('description', event.target.value)}
              placeholder={field.placeholder || t('submit.description_placeholder')}
              rows={3}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
            <p className="mt-1 text-right text-xs text-gray-400">{form.description.length}/500</p>
          </div>
        );
      case 'f_electricity':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id} className="mb-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700">{field.label || t('submit.impact_title_elec_label')} {field.required && '*'}</label>
            <p className="mb-2 text-sm text-gray-500">{t('submit.impact_subtitle_elec')}</p>
            <div className="space-y-1.5">
              {ELECTRICITY_CONDITIONS.map((condition) => (
                <button
                  key={condition.id}
                  type="button"
                  onClick={() => set('electricity_condition', condition.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                    form.electricity_condition === condition.id
                      ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {form.electricity_condition === condition.id ? (
                    <CheckCircle size={16} className="flex-shrink-0 text-un-blue" />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-300" />
                  )}
                  {optionLabels[condition.id] || t(`electricity.${condition.id}`, { defaultValue: condition.label })}
                </button>
              ))}
            </div>
            {errors.electricity_condition && <p className="mt-1 text-xs text-red-500">{errors.electricity_condition}</p>}
          </div>
        );
        }
      case 'f_health':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id} className="mb-5">
            <label className="mb-2 block text-sm font-semibold text-gray-700">{field.label || t('submit.impact_title_health_label')} {field.required && '*'}</label>
            <p className="mb-2 text-sm text-gray-500">{t('submit.impact_subtitle_health')}</p>
            <div className="space-y-1.5">
              {HEALTH_SERVICES.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => set('health_services', service.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                    form.health_services === service.id
                      ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {form.health_services === service.id ? (
                    <CheckCircle size={16} className="flex-shrink-0 text-un-blue" />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0 rounded-full border-2 border-gray-300" />
                  )}
                  {optionLabels[service.id] || t(`health.${service.id}`, { defaultValue: service.label })}
                </button>
              ))}
            </div>
            {errors.health_services && <p className="mt-1 text-xs text-red-500">{errors.health_services}</p>}
          </div>
        );
        }
      case 'f_pressing_needs':
        {
          const optionLabels = Object.fromEntries((field.options || []).map((option) => [option.id, option.label]));
        return (
          <div key={field.id}>
            <label className="mb-2 block text-sm font-semibold text-gray-700">
              {field.label || t('submit.impact_title_needs_label')} {field.required && '*'}
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {PRESSING_NEEDS.map((need) => (
                <button
                  key={need.id}
                  type="button"
                  onClick={() => toggleNeed(need.id)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${
                    form.pressing_needs.includes(need.id)
                      ? 'border-un-blue bg-un-light font-semibold text-un-dark'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 ${
                      form.pressing_needs.includes(need.id) ? 'border-un-blue bg-un-blue' : 'border-gray-300'
                    }`}
                  >
                    {form.pressing_needs.includes(need.id) && <span className="text-[10px] text-white">OK</span>}
                  </div>
                  <span>{optionLabels[need.id] || t(`needs.${need.id}`, { defaultValue: need.label })}</span>
                </button>
              ))}
            </div>
            {form.pressing_needs.includes('other') && (
              <input
                type="text"
                value={form.pressing_needs_other}
                onChange={(event) => set('pressing_needs_other', event.target.value)}
                placeholder={t('submit.needs_other_placeholder')}
                className="mt-2 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
              />
            )}
            {errors.pressing_needs && <p className="mt-1 text-xs text-red-500">{errors.pressing_needs}</p>}
          </div>
        );
        }
      case 'f_photos':
        return null;
      default:
        return null;
    }
  };

  const renderedStepFields = currentStepFields
    .map((field) => renderStepField(field))
    .filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">
      {!isOnline && (
        <div className="flex items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-semibold text-white">
          <WifiOff size={14} />
          {t('submit.offline_banner')}
          {queueSize > 0 && <span className="ml-auto">{`${queueSize} ${t('submit.queued')}`}</span>}
        </div>
      )}

      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            {stepLabels.map((label, index) => (
              <div key={label} className="flex items-center">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    index < step
                      ? 'bg-un-blue text-white'
                      : index === step
                        ? 'bg-un-dark text-white ring-2 ring-un-blue/30'
                        : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {index < step ? 'OK' : index + 1}
                </div>
                {index < stepLabels.length - 1 && (
                  <div className={`mx-1 h-0.5 w-8 transition-all sm:w-12 ${index < step ? 'bg-un-blue' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400">
            {t('submit.step')} {step + 1} {t('submit.of')} {stepLabels.length}{' '}
            <span className="font-semibold text-gray-600">{currentStepDef.title || t(currentStepDef.label_key)}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          {currentStepId === 'location' && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-800">{currentStepDef.title || t('submit.location_title')}</h2>
              <p className="mb-4 text-sm text-gray-500">{currentStepDef.description || t('submit.location_subtitle')}</p>

              <button
                type="button"
                onClick={getLocation}
                disabled={gpsLoading}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-un-blue py-2.5 text-sm font-semibold text-un-blue transition-colors hover:bg-un-light disabled:opacity-60"
              >
                {gpsLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t('submit.getting_gps')}
                  </>
                ) : (
                  <>
                    <MapPin size={16} />
                    {t('submit.use_gps')}
                  </>
                )}
              </button>

              {gpsError && (
                <p className="mb-3 flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle size={13} />
                  {gpsError}
                </p>
              )}

              <p className="mb-2 text-xs text-gray-400">
                {footprintStatus.available
                  ? t('submit.map_tap_hint', { defaultValue: 'Tap a building to bind the report to that structure, or tap the map to drop a pin.' })
                  : t('submit.map_tap_hint', { defaultValue: 'Tap the map to drop a pin, or use GPS/search below.' })}
              </p>

              {footprintStatus.available && (
                <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700">
                  {selectedBuildingActive
                    ? t('submit.building_selected', { defaultValue: 'Selected building will be saved with this report.' })
                    : t('submit.building_selection_on', { defaultValue: 'Building footprints are available here. Tap one building to select the exact structure.' })}
                </div>
              )}

              {!footprintStatus.loading && !footprintStatus.available && (
                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {t('submit.manual_coordinates_hint', {
                    defaultValue: 'Building footprints are unavailable here. Use GPS, a dropped pin, manual coordinates, or a text description instead.',
                  })}
                </div>
              )}

              <div className="mb-2 overflow-hidden rounded-xl border border-gray-200" style={{ height: 280 }}>
                <MapContainer center={mapCenter} zoom={form.lat ? 16 : 12} style={{ height: '100%', width: '100%' }} zoomControl>
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />
                  <MapFlyTo lat={form.lat} lng={form.lng} />
                  <BuildingFootprintLayer
                    crisisEventId="default"
                    enabled={true}
                    selectedLat={form.lat}
                    selectedLng={form.lng}
                    selectedFootprintSetId={form.footprint_set_id}
                    selectedFootprintFeatureId={form.footprint_feature_id}
                    selectedFootprintFeatureKey={form.footprint_feature_key}
                    onAvailabilityChange={setFootprintStatus}
                    onBuildingSelect={(selection) => {
                      setFootprintLocation({
                        lat: selection.lat,
                        lng: selection.lng,
                        label: getFootprintLabelFromProperties(selection.properties || {}),
                        footprint_set_id: selection.footprint_set_id,
                        footprint_feature_id: selection.footprint_feature_id,
                        footprint_feature_key: selection.footprint_feature_key,
                      });
                    }}
                  />
                  <LocationPicker
                    lat={form.lat}
                    lng={form.lng}
                    onChange={(lat, lng) => {
                      setFreeformLocation(lat, lng, 'map');
                    }}
                  />
                </MapContainer>
              </div>

              {selectedBuildingActive && (
                <div className="mb-3 flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                  <span>
                    {form.building_label
                      ? `${t('submit.building_selected', { defaultValue: 'Building selected' })}: ${form.building_label}`
                      : t('submit.building_selected', { defaultValue: 'Building selected' })}
                  </span>
                  <button
                    type="button"
                    onClick={() => clearFootprintSelection()}
                    className="font-semibold text-green-800 underline underline-offset-2"
                  >
                    {t('map.clear', { defaultValue: 'Clear' })}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="submit-latitude" className="mb-1 block text-sm font-semibold text-gray-700">
                    {t('submit.latitude_label', { defaultValue: 'Latitude' })}
                  </label>
                  <input
                    id="submit-latitude"
                    type="number"
                    step="any"
                    value={form.lat || ''}
                    onChange={(event) => {
                      setFreeformLocation(parseCoordinate(event.target.value), form.lng, 'manual_coordinates');
                    }}
                    placeholder={t('submit.latitude_placeholder', { defaultValue: 'e.g. 15.3694' })}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                </div>
                <div>
                  <label htmlFor="submit-longitude" className="mb-1 block text-sm font-semibold text-gray-700">
                    {t('submit.longitude_label', { defaultValue: 'Longitude' })}
                  </label>
                  <input
                    id="submit-longitude"
                    type="number"
                    step="any"
                    value={form.lng || ''}
                    onChange={(event) => {
                      setFreeformLocation(form.lat, parseCoordinate(event.target.value), 'manual_coordinates');
                    }}
                    placeholder={t('submit.longitude_placeholder', { defaultValue: 'e.g. 44.1910' })}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-gray-400">
                {t('submit.manual_coordinates_hint', {
                  defaultValue: 'You can enter coordinates directly if map interaction or GPS is unavailable.',
                })}
              </p>

              {form.lat !== 0 && (
                <p className="mt-2 text-center text-xs text-gray-400">
                  {form.lat.toFixed(5)}, {form.lng.toFixed(5)}
                </p>
              )}

              <AddressAutocomplete
                value={form.address_text}
                lang={currentLanguage}
                label={t('submit.location_description_label', { defaultValue: 'Address / location description' })}
                optionalLabel={t('submit.area_optional')}
                placeholder={t('submit.location_description_placeholder', { defaultValue: 'e.g. Near the central market, west side of the clinic' })}
                helpText={t('submit.location_description_tip', { defaultValue: 'Use landmarks, block names, or access notes responders would recognize.' })}
                searchHint={t('submit.address_search_hint', {
                  defaultValue: 'Type 3 or more characters to search OpenStreetMap, or describe the location manually.',
                })}
                onChange={(value) => set('address_text', value)}
                onPreview={(lat, lng) => {
                  setForm((current) => {
                    const canAutoPreview = current.location_capture_mode === 'unknown'
                      || current.location_capture_mode === 'search'
                      || (!current.lat && !current.lng);
                    if (!canAutoPreview) return current;
                    return {
                      ...current,
                      lat,
                      lng,
                      location_capture_mode: 'search',
                      building_label: '',
                      footprint_set_id: '',
                      footprint_feature_id: '',
                      footprint_feature_key: '',
                    };
                  });
                }}
                onSelect={(lat, lng, label) => {
                  setForm((current) => ({
                    ...current,
                    lat,
                    lng,
                    address_text: label,
                    building_label: '',
                    location_capture_mode: 'search',
                    footprint_set_id: '',
                    footprint_feature_id: '',
                    footprint_feature_key: '',
                  }));
                }}
              />

              {errors.location && (
                <p className="mt-2 flex items-center gap-1 text-xs text-red-500">
                  <AlertTriangle size={12} />
                  {errors.location}
                </p>
              )}

              {renderedStepFields.length > 0 && (
                <div className="mt-5 space-y-4">{renderedStepFields}</div>
              )}
            </div>
          )}

          {currentStepId === 'infrastructure' && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-800">{currentStepDef.title || t('submit.infra_title')}</h2>
              <p className="mb-4 text-sm text-gray-500">{currentStepDef.description || t('submit.infra_subtitle')}</p>
              <div className="space-y-4">{renderedStepFields}</div>
            </div>
          )}

          {currentStepId === 'damage' && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-800">{currentStepDef.title || t('submit.damage_title')}</h2>
              <p className="mb-4 text-sm text-gray-500">{currentStepDef.description || t('submit.damage_subtitle')}</p>
              <div className="space-y-4">{renderedStepFields}</div>
            </div>
          )}

          {currentStepId === 'impact' && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-800">{currentStepDef.title || t('submit.step_impact')}</h2>
              {currentStepDef.description && <p className="mb-4 text-sm text-gray-500">{currentStepDef.description}</p>}
              <div className="space-y-4">{renderedStepFields}</div>
            </div>
          )}

          {currentStepId === 'photos' && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-gray-800">{currentStepDef.title || t('submit.photos_title')}</h2>
              <p className="mb-4 text-sm text-gray-500">{currentStepDef.description || t('submit.photos_subtitle')}</p>

              {renderedStepFields.length > 0 && (
                <div className="mb-5 space-y-4">{renderedStepFields}</div>
              )}

              {isFieldVisible('f_photos') && photos.length < 5 && (
                <label
                  className={`mb-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors ${
                    compressing ? 'border-gray-200 bg-gray-50' : 'border-un-blue/40 hover:border-un-blue hover:bg-un-light'
                  }`}
                >
                  {compressing ? (
                    <>
                      <Loader2 size={24} className="mb-2 animate-spin text-un-blue" />
                      <span className="text-sm text-gray-500">{t('submit.compressing')}</span>
                    </>
                  ) : (
                    <>
                      <Camera size={24} className="mb-2 text-un-blue" />
                      <span className="text-sm font-medium text-gray-700">{t('submit.add_photos')}</span>
                      <span className="mt-1 text-xs text-gray-400">
                        {`${5 - photos.length} ${t(5 - photos.length === 1 ? 'submit.summary_photos' : 'submit.summary_photos_plural')} - ${t('submit.auto_compressed')}`}
                      </span>
                    </>
                  )}
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotos} disabled={compressing} />
                </label>
              )}

              {isFieldVisible('f_photos') && photoPreviews.length > 0 && (
                <div className="mb-4 grid grid-cols-3 gap-2">
                  {photoPreviews.map((src, index) => (
                    <div key={`${src.slice(0, 32)}-${index}`} className="relative aspect-square">
                      <img src={src} alt="" className="h-full w-full rounded-xl object-cover" />
                      <button
                        type="button"
                        onClick={() => removePhoto(index)}
                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white shadow-md hover:bg-red-600"
                      >
                        <X size={10} />
                      </button>
                      {photoSizes[index] && (
                        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-xs text-white">
                          {(photoSizes[index].compressed / 1024).toFixed(0)}KB
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => set('is_urgent', !form.is_urgent)}
                  className={`w-full rounded-xl border-2 p-4 text-left transition-all ${
                    form.is_urgent ? 'border-red-400 bg-red-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className={`text-sm font-bold ${form.is_urgent ? 'text-red-600' : 'text-gray-700'}`}>
                        {t('submit.urgent_label')}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-400">{t('submit.urgent_desc')}</p>
                    </div>
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                        form.is_urgent ? 'border-red-500 bg-red-500' : 'border-gray-300'
                      }`}
                    >
                      {form.is_urgent && <span className="text-[10px] text-white">OK</span>}
                    </div>
                  </div>
                </button>
              </div>

              <div className="mb-5">
                <label htmlFor="submit-contact" className="mb-1 block text-sm font-semibold text-gray-700">
                  {t('submit.contact_label')} <span className="font-normal text-gray-400">{t('submit.description_optional')}</span>
                </label>
                <input
                  id="submit-contact"
                  type="text"
                  value={form.submitter_contact}
                  onChange={(event) => set('submitter_contact', event.target.value)}
                  placeholder={t('submit.contact_placeholder')}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue/30"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {t('submit.contact_confidential', { defaultValue: 'Your information is kept confidential.' })}
                </p>
              </div>

              {errors.submit && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{errors.submit}</span>
                </div>
              )}

              {!hasRequiredConsent && !errors.submit && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                  <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                  <span>{t('consent.blocked_message', { defaultValue: 'Choose a privacy option to continue with account and reporting features.' })}</span>
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting || !hasRequiredConsent}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-dark py-3.5 text-base font-bold text-white transition-colors hover:bg-un-dark/90 disabled:opacity-60"
              >
                {submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    {t('submit.btn_submitting')}
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    {t('submit.btn_submit')}
                  </>
                )}
              </button>

              <p className="mt-3 text-center text-xs text-gray-400">
                {t('submit.confirmation_note', {
                  defaultValue: 'By submitting, you confirm this information is accurate to the best of your knowledge.',
                })}
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={back}
              disabled={submitting}
              className="flex-1 rounded-xl border border-gray-300 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {t('submit.btn_back')}
            </button>
          )}
          {step < stepLabels.length - 1 && (
            <button
              type="button"
              onClick={next}
              className="flex-1 rounded-xl bg-un-blue py-3 text-sm font-semibold text-white transition-colors hover:bg-un-blue/90"
            >
              {t('submit.btn_continue')}
            </button>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-300">UNDP Crisis Damage Reporting Platform</p>
      </div>
    </div>
  );
}
