import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  Loader2,
  Search,
  Settings,
  Siren,
  TriangleAlert,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, type ClassificationStatusResponse } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';
import { formatMediaStateLabel } from '../../utils/reportPresentation';

interface AdminReport {
  id: string;
  address?: string;
  damage_level?: string;
  infra_category?: string;
  photos?: unknown[];
  photo_count?: number;
  media_state?: 'none' | 'ready' | 'partial_missing' | 'invalid_legacy';
  ai_media_eligibility?: 'eligible' | 'no_photos' | 'missing_media' | 'invalid_media';
}

interface ClassifyResult {
  success?: boolean;
  provider?: string;
  damage_level: string;
  confidence: number;
  reasoning: string;
  debris_visible: boolean;
  urgent: boolean;
  model?: string;
  classified_at?: string;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  const responseError = (error as { response?: { data?: { error?: string } } })?.response?.data;
  return responseError?.error || (error instanceof Error ? error.message : fallback);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function getClassificationStatusMessage(status: string, t: ReturnType<typeof useTranslation>['t']) {
  if (status === 'queued') return t('admin.ai_panel.classify_queued', { defaultValue: 'Classification queued. Waiting for worker...' });
  if (status === 'processing') return t('admin.ai_panel.classify_processing', { defaultValue: 'Classification in progress...' });
  if (status === 'retry_wait') return t('admin.ai_panel.classify_retry_wait', { defaultValue: 'Classification waiting to retry...' });
  if (status === 'failed_terminal') return t('admin.ai_panel.classify_failed', { defaultValue: 'Classification failed.' });
  if (status === 'completed') return t('admin.ai_panel.classify_completed', { defaultValue: 'Classification completed.' });
  return '';
}

function StatusChip({ label, active = true }: { label: string; active?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${active ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-gray-200 bg-gray-100 text-gray-500'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-green-500' : 'bg-gray-400'}`} />
      {label}
    </span>
  );
}

function DamageBadge({ level, unknownLabel }: { level?: string; unknownLabel: string }) {
  const map: Record<string, string> = {
    destroyed: 'bg-red-100 text-red-800 border-red-200',
    partial: 'bg-orange-100 text-orange-800 border-orange-200',
    minimal: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    none: 'bg-green-100 text-green-800 border-green-200',
  };
  const key = (level || 'unknown').toLowerCase();
  return <span className={`inline-flex rounded border px-2 py-0.5 text-xs font-semibold uppercase ${map[key] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>{level || unknownLabel}</span>;
}

function ErrorBox({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>{message}</span></div>;
}

function SuccessBox({ message }: { message: string }) {
  return <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"><CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0" /><span>{message}</span></div>;
}

function withSelectedModel(options: string[], selected: string): string[] {
  const normalized = String(selected || '').trim();
  if (!normalized) return options;
  return options.includes(normalized) ? options : [normalized, ...options];
}

export default function AIPanel() {
  type TabId = 'settings' | 'classify';
  const { t } = useTranslation();

  const futureIntegrations = [
    {
      title: 'MobileNet (local, vision only)',
      description: t('admin.ai_panel.future_mobilenet', { defaultValue: 'Reserved for a future local-only vision path and not part of the active pipeline.' }),
    },
    {
      title: 'Phi-3.5 Mini Instruct',
      description: t('admin.ai_panel.future_phi', { defaultValue: 'Reserved for a future compact text-model path for lightweight local or edge deployments.' }),
    },
    {
      title: 'Qwen2.5-7B Instruct',
      description: t('admin.ai_panel.future_qwen', { defaultValue: 'Reserved for a future compact text-model path for server-managed summarization and assistant workloads.' }),
    },
    {
      title: 'MADLAD-400 3B MT',
      description: t('admin.ai_panel.future_madlad', { defaultValue: 'Reserved for a future dedicated translation path when translation is split from the main text pipeline.' }),
    },
  ];

  const getEligibilityLabel = (eligibility?: AdminReport['ai_media_eligibility']): string => {
    if (eligibility === 'no_photos') return t('admin.ai_panel.eligibility_no_photos', { defaultValue: 'No photos' });
    if (eligibility === 'missing_media') return t('admin.ai_panel.eligibility_missing_media', { defaultValue: 'Missing photo file' });
    if (eligibility === 'invalid_media') return t('admin.ai_panel.eligibility_invalid_media', { defaultValue: 'Invalid legacy photo reference' });
    return t('admin.ai_panel.eligibility_eligible', { defaultValue: 'Eligible' });
  };

  const [activeTab, setActiveTab] = useState<TabId>('settings');
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsSuccess, setSettingsSuccess] = useState('');
  const [formVisionModel, setFormVisionModel] = useState('google/gemma-4-26b-a4b-it:free');
  const [formVisionFallbackModel1, setFormVisionFallbackModel1] = useState('google/gemma-4-31b-it:free');
  const [formVisionFallbackModel2, setFormVisionFallbackModel2] = useState('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  const [formTextModel, setFormTextModel] = useState('qwen/qwen3-next-80b-a3b-instruct:free');
  const [formTextFallbackModel1, setFormTextFallbackModel1] = useState('openai/gpt-oss-20b:free');
  const [formTextFallbackModel2, setFormTextFallbackModel2] = useState('meta-llama/llama-3.3-70b-instruct:free');
  const [formTranslationModel, setFormTranslationModel] = useState('qwen/qwen3-next-80b-a3b-instruct:free');
  const [formTranslationFallbackModel1, setFormTranslationFallbackModel1] = useState('openai/gpt-oss-20b:free');
  const [formTranslationFallbackModel2, setFormTranslationFallbackModel2] = useState('openrouter/free');
  const [availableModels, setAvailableModels] = useState<{ vision: string[]; text: string[]; translation: string[] } | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsSource, setModelsSource] = useState('');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [ineligibleReports, setIneligibleReports] = useState<AdminReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState('');
  const [selectedReportId, setSelectedReportId] = useState('');
  const [classifying, setClassifying] = useState(false);
  const [classifyError, setClassifyError] = useState('');
  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [classifyJobStatus, setClassifyJobStatus] = useState('');
  const [applySuccess, setApplySuccess] = useState('');
  const [applyError, setApplyError] = useState('');
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const classifyPollTimer = useRef<number | null>(null);

  const loadAiStatus = useCallback(async () => {
    try {
      setStatusLoading(true);
      setStatusError('');
      await api.getAiStatus();
    } catch (error: unknown) {
      setStatusError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  const loadSettings = useCallback(async () => {
    try {
      setSettingsLoading(true);
      setSettingsError('');
      const response = await api.getAiSettings() as { settings: Record<string, string> };
      const settings = response.settings || {};
      setFormVisionModel(settings.model_vision || 'google/gemma-4-26b-a4b-it:free');
      setFormVisionFallbackModel1(settings.model_vision_fallback_1 || 'google/gemma-4-31b-it:free');
      setFormVisionFallbackModel2(settings.model_vision_fallback_2 || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
      setFormTextModel(settings.model_text || 'openai/gpt-oss-120b:free');
      setFormTextFallbackModel1(settings.model_text_fallback_1 || 'openai/gpt-oss-20b:free');
      setFormTextFallbackModel2(settings.model_text_fallback_2 || 'qwen/qwen3-coder:free');
      setFormTranslationModel(settings.translation_model || settings.model_text || 'openai/gpt-oss-120b:free');
      setFormTranslationFallbackModel1(settings.translation_fallback_model_1 || 'openai/gpt-oss-20b:free');
      setFormTranslationFallbackModel2(settings.translation_fallback_model_2 || 'openrouter/free');

      try {
        setModelsLoading(true);
        const modelResponse = await api.getAiModels();
        setAvailableModels(modelResponse.models);
        setModelsSource(modelResponse.source);
      } catch {
        setAvailableModels(null);
      } finally {
        setModelsLoading(false);
      }
    } catch (error: unknown) {
      setSettingsError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    } finally {
      setSettingsLoading(false);
    }
  }, [t]);

  const loadReports = useCallback(async () => {
    try {
      setReportsLoading(true);
      setReportsError('');
      const response = await api.getAdminReports({ limit: '30', status: 'pending' }) as { reports: AdminReport[] };
      const eligible = (response.reports || []).filter((report) => report.ai_media_eligibility === 'eligible');
      const ineligible = (response.reports || []).filter((report) => report.ai_media_eligibility && report.ai_media_eligibility !== 'eligible');
      setReports(eligible);
      setIneligibleReports(ineligible);
    } catch (error: unknown) {
      setReportsError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    } finally {
      setReportsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const loadId = scheduleTask(() => {
      void loadAiStatus();
    });
    return () => window.clearTimeout(loadId);
  }, [loadAiStatus]);
  useEffect(() => {
    const loadId = scheduleTask(() => {
      if (activeTab === 'settings') void loadSettings();
      if (activeTab === 'classify') void loadReports();
    });
    return () => window.clearTimeout(loadId);
  }, [activeTab, loadReports, loadSettings]);

  useEffect(() => () => {
    if (classifyPollTimer.current) {
      window.clearTimeout(classifyPollTimer.current);
    }
  }, []);

  function showSuccess(message: string) {
    setSettingsSuccess(message);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSettingsSuccess(''), 3000);
  }

  async function saveSettings() {
    try {
      setSettingsSaving(true);
      setSettingsError('');
      await api.saveAiSettings({
        model_vision: formVisionModel,
        model_vision_fallback_1: formVisionFallbackModel1,
        model_vision_fallback_2: formVisionFallbackModel2,
        model_text: formTextModel,
        model_text_fallback_1: formTextFallbackModel1,
        model_text_fallback_2: formTextFallbackModel2,
        translation_model: formTranslationModel,
        translation_fallback_model_1: formTranslationFallbackModel1,
        translation_fallback_model_2: formTranslationFallbackModel2,
      });
      showSuccess(t('admin.ai_panel.settings_saved', { defaultValue: 'Settings saved successfully' }));
    } catch (error: unknown) {
      setSettingsError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function runClassification() {
    if (!selectedReportId) return;
    try {
      setClassifying(true);
      setClassifyError('');
      setClassifyResult(null);
      setClassifyJobStatus('');
      setApplySuccess('');
      setApplyError('');
      const response: ClassificationStatusResponse = await api.classifyDamage(selectedReportId);
      if (response.classification) {
        setClassifyResult(response.classification);
        setClassifyJobStatus(getClassificationStatusMessage('completed', t));
        return;
      }
      if (response.status === 'pending' || response.status === 'processing' || response.status === 'retry_wait') {
        setClassifyJobStatus(getClassificationStatusMessage(response.status, t));
        const poll = async () => {
          try {
            const statusResponse: ClassificationStatusResponse = await api.getClassificationStatus(selectedReportId);
            if (statusResponse.classification) {
              setClassifyResult(statusResponse.classification);
              setClassifyJobStatus(getClassificationStatusMessage('completed', t));
              return;
            }
            if (statusResponse.status === 'failed_terminal') {
              setClassifyJobStatus(getClassificationStatusMessage('failed_terminal', t));
              setClassifyError(
                String(statusResponse.job?.last_error_message || t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' }))
              );
              return;
            }
            setClassifyJobStatus(getClassificationStatusMessage(statusResponse.status, t));
            classifyPollTimer.current = window.setTimeout(() => {
              void poll();
            }, 3000);
          } catch (error: unknown) {
            setClassifyError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
          }
        };
        classifyPollTimer.current = window.setTimeout(() => {
          void poll();
        }, 3000);
      }
    } catch (error: unknown) {
      setClassifyError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    } finally {
      setClassifying(false);
    }
  }

  async function applyClassification() {
    if (!classifyResult || !selectedReportId) return;
    try {
      setApplyError('');
      await api.updateReport(selectedReportId, {
        damage_level: classifyResult.damage_level,
        internal_notes: `AI: ${classifyResult.reasoning}`,
      });
      setApplySuccess(t('admin.ai_panel.damage_updated', {
        damage: String(classifyResult.damage_level),
        defaultValue: 'Damage level updated to {{damage}}',
      }));
      setClassifyResult(null);
    } catch (error: unknown) {
      setApplyError(getApiErrorMessage(error, t('admin.ai_panel.request_failed', { defaultValue: 'Request failed' })));
    }
  }

  const selectedReport = reports.find((report) => report.id === selectedReportId);
  const visionOptions = availableModels?.vision || [];
  const visionModelOptions = withSelectedModel(visionOptions, formVisionModel);
  const visionFallbackOptions1 = withSelectedModel(visionOptions, formVisionFallbackModel1);
  const visionFallbackOptions2 = withSelectedModel(visionOptions, formVisionFallbackModel2);
  const textOptions = availableModels?.text || [];
  const textModelOptions = withSelectedModel(textOptions, formTextModel);
  const textFallbackOptions1 = withSelectedModel(textOptions, formTextFallbackModel1);
  const textFallbackOptions2 = withSelectedModel(textOptions, formTextFallbackModel2);
  const translationOptions = availableModels?.translation?.length ? availableModels.translation : availableModels?.text || [];
  const translationModelOptions = withSelectedModel(translationOptions, formTranslationModel);
  const translationFallbackOptions1 = withSelectedModel(translationOptions, formTranslationFallbackModel1);
  const translationFallbackOptions2 = withSelectedModel(withSelectedModel(translationOptions, 'openrouter/free'), formTranslationFallbackModel2);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-un-dark px-6 py-5 text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <Zap className="h-6 w-6 text-un-blue" />
          <div>
            <h1 className="text-xl font-bold">{t('admin.ai_panel.title', { defaultValue: 'AI Features Panel' })}</h1>
            <p className="mt-0.5 text-sm text-blue-200">{t('admin.ai_panel.subtitle', { defaultValue: 'Configure server-managed OpenRouter models and operate AI-assisted workflows' })}</p>
          </div>
          {!statusLoading && !statusError && <div className="ml-auto"><StatusChip label={t('admin.ai_panel.server_managed', { defaultValue: 'Server-managed' })} /></div>}
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {statusError && <div className="mb-4"><ErrorBox message={statusError} /></div>}
        <div className="mb-6 border-b border-gray-200">
          <nav className="flex">
            {[
              { id: 'settings' as const, label: t('admin.ai_panel.tab_settings', { defaultValue: 'Settings' }), Icon: Settings },
              { id: 'classify' as const, label: t('admin.ai_panel.tab_classifier', { defaultValue: 'Damage Classifier' }), Icon: Search },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={[
                  'flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium transition-colors',
                  activeTab === id ? 'border-un-blue text-un-blue' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {activeTab === 'settings' && (
          <div className="space-y-5">
            {settingsLoading ? (
              <div className="flex justify-center py-20"><LoadingSpinner /></div>
            ) : (
              <>
                {settingsError && <ErrorBox message={settingsError} />}
                {settingsSuccess && <SuccessBox message={settingsSuccess} />}

                <div className="space-y-5 rounded-xl border border-gray-200 bg-white p-6">
                  <h2 className="text-base font-semibold text-gray-900">{t('admin.ai_panel.openrouter_models', { defaultValue: 'OpenRouter Models' })}</h2>

                  <div className="space-y-4">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('admin.ai_panel.vision_chain', { defaultValue: 'Vision Chain' })}</h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.vision_model', { defaultValue: 'Vision Model' })}</label>
                          <select aria-label={t('admin.ai_panel.vision_model', { defaultValue: 'Vision Model' })} value={formVisionModel} onChange={(event) => setFormVisionModel(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {visionModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.vision_fallback_model_1', { defaultValue: 'Vision Fallback 1' })}</label>
                          <select aria-label={t('admin.ai_panel.vision_fallback_model_1', { defaultValue: 'Vision Fallback 1' })} value={formVisionFallbackModel1} onChange={(event) => setFormVisionFallbackModel1(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {visionFallbackOptions1.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.vision_fallback_model_2', { defaultValue: 'Vision Fallback 2' })}</label>
                          <select aria-label={t('admin.ai_panel.vision_fallback_model_2', { defaultValue: 'Vision Fallback 2' })} value={formVisionFallbackModel2} onChange={(event) => setFormVisionFallbackModel2(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {visionFallbackOptions2.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('admin.ai_panel.text_chain', { defaultValue: 'Text Chain' })}</h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.text_model', { defaultValue: 'Text Model' })}</label>
                          <select aria-label={t('admin.ai_panel.text_model', { defaultValue: 'Text Model' })} value={formTextModel} onChange={(event) => setFormTextModel(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {textModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.text_fallback_model_1', { defaultValue: 'Text Fallback 1' })}</label>
                          <select aria-label={t('admin.ai_panel.text_fallback_model_1', { defaultValue: 'Text Fallback 1' })} value={formTextFallbackModel1} onChange={(event) => setFormTextFallbackModel1(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {textFallbackOptions1.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.text_fallback_model_2', { defaultValue: 'Text Fallback 2' })}</label>
                          <select aria-label={t('admin.ai_panel.text_fallback_model_2', { defaultValue: 'Text Fallback 2' })} value={formTextFallbackModel2} onChange={(event) => setFormTextFallbackModel2(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {textFallbackOptions2.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('admin.ai_panel.translation_chain', { defaultValue: 'Translation Chain' })}</h3>
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.translation_model', { defaultValue: 'Translation Model' })}</label>
                          <select aria-label={t('admin.ai_panel.translation_model', { defaultValue: 'Translation Model' })} value={formTranslationModel} onChange={(event) => setFormTranslationModel(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {translationModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.translation_fallback_model_1', { defaultValue: 'Translation Fallback 1' })}</label>
                          <select aria-label={t('admin.ai_panel.translation_fallback_model_1', { defaultValue: 'Translation Fallback 1' })} value={formTranslationFallbackModel1} onChange={(event) => setFormTranslationFallbackModel1(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {translationFallbackOptions1.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">{t('admin.ai_panel.translation_fallback_model_2', { defaultValue: 'Translation Fallback 2' })}</label>
                          <select aria-label={t('admin.ai_panel.translation_fallback_model_2', { defaultValue: 'Translation Fallback 2' })} value={formTranslationFallbackModel2} onChange={(event) => setFormTranslationFallbackModel2(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue" disabled={modelsLoading}>
                            <option value="">{t('admin.ai_panel.none', { defaultValue: 'None' })}</option>
                            {modelsLoading && <option>{t('admin.ai_panel.loading_models', { defaultValue: 'Loading models...' })}</option>}
                            {translationFallbackOptions2.map((model) => <option key={model} value={model}>{model}</option>)}
                            {modelsSource === 'fallback' && <option disabled>{t('admin.ai_panel.fallback_list', { defaultValue: 'Fallback list in use' })}</option>}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-6">
                  <div className="flex items-center justify-between gap-4">
                    <h2 className="text-base font-semibold text-gray-900">{t('admin.ai_panel.future_integration', { defaultValue: 'Future Integration' })}</h2>
                    <StatusChip label={t('admin.ai_panel.planned', { defaultValue: 'Planned' })} active={false} />
                  </div>

                  {futureIntegrations.map((item) => (
                    <div key={item.title} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                          <p className="mt-1 text-sm text-gray-500">{item.description}</p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{t('admin.ai_panel.not_implemented', { defaultValue: 'Not implemented' })}</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <button onClick={saveSettings} disabled={settingsSaving} className="flex items-center gap-2 rounded-xl bg-un-blue px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60">
                    {settingsSaving ? <><Loader2 className="h-4 w-4 animate-spin" />{t('admin.common.saving', { defaultValue: 'Saving...' })}</> : <><Check className="h-4 w-4" />{t('admin.ai_panel.save_settings', { defaultValue: 'Save Settings' })}</>}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'classify' && (
          <div className="space-y-5">
            {reportsError && <ErrorBox message={reportsError} />}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{t('admin.ai_panel.select_pending_report', { defaultValue: 'Select Pending Report' })}</h3>
                <button type="button" onClick={loadReports} className="text-xs text-un-blue hover:underline">{t('map.refresh', { defaultValue: 'Refresh' })}</button>
              </div>
              {reportsLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
              ) : (
                <select value={selectedReportId} onChange={(event) => setSelectedReportId(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-un-blue">
                  <option value="">{t('admin.ai_panel.select_report_option', { defaultValue: '-- Select a report --' })}</option>
                  {reports.map((report) => (
                    <option key={report.id} value={report.id}>
                      #{report.id} - {report.address || t('admin.ai_panel.no_address', { defaultValue: 'No address' })} - {report.damage_level || t('queue.unknown', { defaultValue: 'Unknown' })}
                    </option>
                  ))}
                </select>
              )}
              {reports.length === 0 && !reportsLoading && <p className="mt-2 text-xs text-gray-400">{t('admin.ai_panel.no_eligible_reports', { defaultValue: 'No AI-eligible pending reports found.' })}</p>}
              {selectedReport && (
                <div className="mt-3 space-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">{t('admin.ai_panel.id', { defaultValue: 'ID' })}:</span>
                    <span className="font-mono font-bold">{selectedReport.id}</span>
                    <DamageBadge level={selectedReport.damage_level} unknownLabel={t('queue.unknown', { defaultValue: 'Unknown' })} />
                  </div>
                  <div><span className="text-gray-500">{t('account.address', { defaultValue: 'Address' })}: </span>{selectedReport.address || t('admin.ai_panel.not_available', { defaultValue: 'N/A' })}</div>
                  <div><span className="text-gray-500">{t('admin.reports.category', { defaultValue: 'Category' })}: </span>{selectedReport.infra_category || t('admin.ai_panel.not_available', { defaultValue: 'N/A' })}</div>
                  <div><span className="text-gray-500">{t('report.photos', { defaultValue: 'Photos' })}: </span>{selectedReport.photo_count ?? selectedReport.photos?.length ?? 0}</div>
                  <div><span className="text-gray-500">{t('admin.ai_panel.media_state', { defaultValue: 'Media state' })}: </span>{formatMediaStateLabel(selectedReport.media_state)}</div>
                </div>
              )}
            </div>

            {ineligibleReports.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold text-amber-900">{t('admin.ai_panel.ineligible_title', { defaultValue: 'Pending reports not eligible for AI' })}</h3>
                <div className="mt-3 space-y-2">
                  {ineligibleReports.map((report) => (
                    <div key={report.id} className="flex items-center justify-between rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs">
                      <span className="font-mono text-gray-700">{report.id}</span>
                      <span className="text-gray-500">{report.address || t('admin.ai_panel.no_address', { defaultValue: 'No address' })}</span>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">{getEligibilityLabel(report.ai_media_eligibility)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button type="button" onClick={runClassification} disabled={!selectedReportId || classifying} className="flex w-full items-center justify-center gap-2 rounded-xl bg-un-blue py-3 font-semibold text-white transition-colors hover:bg-blue-600 disabled:opacity-60">
              {classifying ? <><Loader2 className="h-5 w-5 animate-spin" />{t('admin.ai_panel.classifying', { defaultValue: 'Classifying...' })}</> : <><Search className="h-5 w-5" />{t('admin.ai_panel.run_classification', { defaultValue: 'Run AI Classification' })}</>}
            </button>

            {classifyJobStatus && <SuccessBox message={classifyJobStatus} />}
            {classifyError && <ErrorBox message={classifyError} />}
            {applySuccess && <SuccessBox message={applySuccess} />}
            {applyError && <ErrorBox message={applyError} />}

            {classifyResult && (
              <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="text-sm font-semibold text-gray-900">{t('admin.ai_panel.classification_result', { defaultValue: 'Classification Result' })}</h3>
                <div>
                  <div className="mb-2 flex items-center gap-3">
                    <DamageBadge level={classifyResult.damage_level} unknownLabel={t('queue.unknown', { defaultValue: 'Unknown' })} />
                    <span className="text-sm font-semibold text-gray-800">
                      {t('admin.ai_panel.confident', {
                        confidence: Math.round(classifyResult.confidence * 100),
                        defaultValue: '{{confidence}}% confident',
                      })}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-200">
                    <div className="h-2 rounded-full bg-un-blue" style={{ width: `${classifyResult.confidence * 100}%` }} />
                  </div>
                </div>
                <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">{classifyResult.reasoning}</div>
                <div className="flex items-center gap-4 text-sm">
                  <span className={`flex items-center gap-1.5 ${classifyResult.debris_visible ? 'text-orange-600' : 'text-gray-400'}`}>
                    <TriangleAlert className="h-4 w-4" /> {t('admin.ai_panel.debris_label', { defaultValue: 'Debris' })}: {classifyResult.debris_visible ? t('admin.ai_panel.visible', { defaultValue: 'Visible' }) : t('admin.ai_panel.not_visible', { defaultValue: 'Not visible' })}
                  </span>
                  <span className={`flex items-center gap-1.5 ${classifyResult.urgent ? 'font-semibold text-red-600' : 'text-gray-400'}`}>
                    <Siren className="h-4 w-4" /> {classifyResult.urgent ? t('common.urgent', { defaultValue: 'URGENT' }) : t('admin.ai_panel.not_urgent', { defaultValue: 'Not urgent' })}
                  </span>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <button type="button" onClick={applyClassification} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700">
                    <Check className="h-4 w-4" /> {t('admin.ai_panel.apply_suggestion', { defaultValue: 'Apply Suggestion' })}
                  </button>
                  <button type="button" onClick={() => setClassifyResult(null)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">{t('admin.common.cancel', { defaultValue: 'Cancel' })}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
