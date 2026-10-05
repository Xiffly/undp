import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import LoadingSpinner from '../../components/LoadingSpinner';

interface FieldOption {
  id: string;
  label: string;
  label_key?: string;
  order?: number;
}

interface FormField {
  id: string;
  key: string;
  label_key: string;
  description_key?: string;
  section: string;
  type: 'single_select' | 'multi_select' | 'text' | 'yesno' | 'radio' | 'section_header' | 'photo_upload';
  label: string;
  description?: string;
  required: boolean;
  order: number;
  options: FieldOption[];
  placeholder?: string;
  enabled: boolean;
  removable: boolean;
  is_core?: boolean;
}

interface FormSection {
  id: string;
  key: string;
  label_key: string;
  title: string;
  description?: string;
  order: number;
  enabled: boolean;
  can_hide: boolean;
  fields: FormField[];
}

type AddFieldDraft = {
  label: string;
  description: string;
  type: 'text' | 'single_select' | 'multi_select' | 'photo_upload';
  required: boolean;
  options: FieldOption[];
};

type FieldDraft = {
  label: string;
  description: string;
  options: FieldOption[];
};

const TYPE_LABELS: Record<FormField['type'], string> = {
  single_select: 'Single Choice',
  multi_select: 'Multiple Choice',
  text: 'Text',
  yesno: 'Yes / No',
  radio: 'Single Choice',
  section_header: 'System Field',
  photo_upload: 'Photo Upload',
};

const ADDABLE_TYPES: AddFieldDraft['type'][] = ['text', 'single_select', 'multi_select', 'photo_upload'];
const CHOICE_TYPES: FormField['type'][] = ['single_select', 'multi_select', 'radio'];

function defaultAddFieldDraft(): AddFieldDraft {
  return {
    label: '',
    description: '',
    type: 'text',
    required: false,
    options: [],
  };
}

function cloneOptions(options: FieldOption[]) {
  return options.map((option, index) => ({
    id: option.id || `option_${index + 1}`,
    label: option.label,
    label_key: option.label_key,
    order: typeof option.order === 'number' ? option.order : index + 1,
  }));
}

function normalizeOptions(options: FieldOption[]) {
  return options
    .map((option, index) => ({
      id: String(option.id || `option_${index + 1}`),
      label: String(option.label || '').trim(),
      label_key: option.label_key,
      order: index + 1,
    }))
    .filter((option) => option.label);
}

function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

function OptionsEditor({
  options,
  disabled,
  onChange,
}: {
  options: FieldOption[];
  disabled: boolean;
  onChange: (next: FieldOption[]) => void;
}) {
  const { t } = useTranslation();

  const updateOption = (index: number, patch: Partial<FieldOption>) => {
    onChange(options.map((option, currentIndex) => (currentIndex === index ? { ...option, ...patch } : option)));
  };

  const moveOption = (index: number, direction: 'up' | 'down') => {
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= options.length) return;
    const next = [...options];
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    onChange(next);
  };

  const deleteOption = (index: number) => {
    onChange(options.filter((_, currentIndex) => currentIndex !== index));
  };

  const addOption = () => {
    onChange([
      ...options,
      {
        id: `option_${options.length + 1}`,
        label: '',
        order: options.length + 1,
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">
        {t('admin.form_builder.choice_options', { defaultValue: 'Choice options' })}
      </label>
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-2">
          <input
            type="text"
            value={option.label}
            onChange={(event) => updateOption(index, { label: event.target.value })}
            disabled={disabled}
            placeholder={t('admin.form_builder.option_label_required', { defaultValue: 'Option label *' })}
            className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => moveOption(index, 'up')}
            disabled={disabled || index === 0}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Move option up"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => moveOption(index, 'down')}
            disabled={disabled || index === options.length - 1}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Move option down"
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            onClick={() => deleteOption(index)}
            disabled={disabled}
            className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Delete option"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={14} />
        {t('admin.form_builder.add_option', { defaultValue: 'Add option' })}
      </button>
    </div>
  );
}

function FieldEditorRow({
  field,
  draft,
  disabled,
  onChange,
  onSave,
  onToggleEnabled,
  onToggleRequired,
  onMove,
  onDelete,
}: {
  field: FormField;
  draft: FieldDraft;
  disabled: boolean;
  onChange: (next: FieldDraft) => void;
  onSave: () => void;
  onToggleEnabled: () => void;
  onToggleRequired: () => void;
  onMove: (direction: 'up' | 'down') => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const optionsEditable = CHOICE_TYPES.includes(field.type);
  const normalizedDraftOptions = normalizeOptions(draft.options);
  const normalizedFieldOptions = normalizeOptions(field.options);
  const isDirty =
    draft.label.trim() !== field.label.trim() ||
    (draft.description || '').trim() !== (field.description || '').trim() ||
    JSON.stringify(normalizedDraftOptions.map((option) => option.label)) !==
      JSON.stringify(normalizedFieldOptions.map((option) => option.label));

  return (
    <div className={`rounded-xl border px-4 py-4 ${field.enabled ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50'}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">{TYPE_LABELS[field.type]}</span>
            {!field.removable && (
              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                {t('admin.form_builder.required_in_flow', { defaultValue: 'Required in live flow' })}
              </span>
            )}
          </div>

          <input
            type="text"
            value={draft.label}
            onChange={(event) => onChange({ ...draft, label: event.target.value })}
            disabled={disabled}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
          />

          <textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            disabled={disabled}
            rows={2}
            placeholder={t('admin.form_builder.field_description_placeholder', { defaultValue: 'Optional help text / description' })}
            className="w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
          />

          {optionsEditable && (
            <OptionsEditor
              options={draft.options}
              disabled={disabled}
              onChange={(next) => onChange({ ...draft, options: next })}
            />
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={field.required}
                onChange={onToggleRequired}
                disabled={disabled}
                className="rounded border-gray-300 text-un-blue focus:ring-un-blue/30"
              />
              <span>{t('admin.form_builder.required', { defaultValue: 'Required' })}</span>
            </label>
            {normalizedDraftOptions.length > 0 && (
              <span>{t('admin.form_builder.options_count', { defaultValue: '{{count}} choices', count: normalizedDraftOptions.length })}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={disabled || !draft.label.trim() || (optionsEditable && normalizedDraftOptions.length === 0) || !isDirty}
            className="flex items-center justify-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={14} />
            {t('admin.common.save', { defaultValue: 'Save' })}
          </button>
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={disabled}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Move field up"
          >
            <ArrowUp size={16} />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={disabled}
            className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
            title="Move field down"
          >
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            onClick={onToggleEnabled}
            disabled={disabled}
            className={`rounded-lg border p-2 transition-colors ${
              field.enabled
                ? 'border-un-blue/30 bg-un-light text-un-blue hover:bg-blue-100'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            } disabled:cursor-not-allowed disabled:opacity-40`}
            title={field.enabled ? 'Hide field' : 'Show field'}
          >
            {field.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled || !field.removable}
            className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-30"
            title="Delete field"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddFieldComposer({
  draft,
  disabled,
  open,
  onOpen,
  onCancel,
  onChange,
  onSubmit,
}: {
  draft: AddFieldDraft;
  disabled: boolean;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onChange: (next: AddFieldDraft) => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const needsOptions = draft.type === 'single_select' || draft.type === 'multi_select';
  const normalizedOptions = normalizeOptions(draft.options);

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={16} />
        {t('admin.form_builder.add_field', { defaultValue: 'Add field' })}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plus size={16} className="text-un-blue" />
          <p className="text-sm font-semibold text-gray-800">{t('admin.form_builder.add_field', { defaultValue: 'Add field' })}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          title="Cancel add field"
        >
          <X size={14} />
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <input
          type="text"
          value={draft.label}
          onChange={(event) => onChange({ ...draft, label: event.target.value })}
          disabled={disabled}
          placeholder={t('admin.form_builder.new_field_placeholder', { defaultValue: 'Field label' })}
          className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
        />
        <select
          value={draft.type}
          onChange={(event) => onChange({ ...draft, type: event.target.value as AddFieldDraft['type'], options: ['single_select', 'multi_select'].includes(event.target.value) ? draft.options : [] })}
          disabled={disabled}
          className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
        >
          {ADDABLE_TYPES.map((type) => (
            <option key={type} value={type}>{TYPE_LABELS[type]}</option>
          ))}
        </select>
      </div>

      <textarea
        value={draft.description}
        onChange={(event) => onChange({ ...draft, description: event.target.value })}
        disabled={disabled}
        rows={2}
        placeholder={t('admin.form_builder.field_description_placeholder', { defaultValue: 'Optional help text / description' })}
        className="mt-3 w-full resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30 disabled:opacity-60"
      />

      {needsOptions && (
        <div className="mt-3">
          <OptionsEditor
            options={draft.options}
            disabled={disabled}
            onChange={(next) => onChange({ ...draft, options: next })}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(event) => onChange({ ...draft, required: event.target.checked })}
            disabled={disabled}
            className="rounded border-gray-300 text-un-blue focus:ring-un-blue/30"
          />
          <span>{t('admin.form_builder.required', { defaultValue: 'Required' })}</span>
        </label>
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled || !draft.label.trim() || (needsOptions && normalizedOptions.length === 0)}
          className="rounded-xl bg-un-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('admin.form_builder.add_field', { defaultValue: 'Add field' })}
        </button>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  titleDraft,
  updating,
  fieldDrafts,
  addDraft,
  addOpen,
  onTitleChange,
  onSaveTitle,
  onToggleSection,
  onFieldDraftChange,
  onSaveField,
  onToggleField,
  onToggleRequired,
  onMoveField,
  onDeleteField,
  onAddDraftChange,
  onOpenAddField,
  onCancelAddField,
  onAddField,
}: {
  section: FormSection;
  titleDraft: string;
  updating: boolean;
  fieldDrafts: Record<string, FieldDraft>;
  addDraft: AddFieldDraft;
  addOpen: boolean;
  onTitleChange: (value: string) => void;
  onSaveTitle: () => void;
  onToggleSection: () => void;
  onFieldDraftChange: (fieldId: string, next: FieldDraft) => void;
  onSaveField: (field: FormField) => void;
  onToggleField: (field: FormField) => void;
  onToggleRequired: (field: FormField) => void;
  onMoveField: (field: FormField, direction: 'up' | 'down') => void;
  onDeleteField: (field: FormField) => void;
  onAddDraftChange: (next: AddFieldDraft) => void;
  onOpenAddField: () => void;
  onCancelAddField: () => void;
  onAddField: () => void;
}) {
  const { t } = useTranslation();
  const titleDirty = titleDraft.trim() !== section.title.trim();

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-un-light px-2 py-1 text-xs font-semibold text-un-blue">
              {t('admin.form_builder.workflow_section', { defaultValue: 'Submission step' })}
            </span>
            {!section.enabled && (
              <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-500">
                {t('admin.form_builder.hidden', { defaultValue: 'Hidden' })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={titleDraft}
              onChange={(event) => onTitleChange(event.target.value)}
              className="min-w-[220px] flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 focus:border-un-blue focus:outline-none focus:ring-2 focus:ring-un-blue/30"
            />
            <button
              type="button"
              onClick={onSaveTitle}
              disabled={updating || !titleDirty || !titleDraft.trim()}
              className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={14} />
              {t('admin.form_builder.rename_section', { defaultValue: 'Update step name' })}
            </button>
          </div>
          {section.description && <p className="mt-2 text-sm text-gray-500">{section.description}</p>}
        </div>

        <button
          type="button"
          onClick={onToggleSection}
          disabled={updating || !section.can_hide}
          className={`rounded-lg border p-2 transition-colors ${
            !section.can_hide
              ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300'
              : section.enabled
                ? 'border-un-blue/30 bg-un-light text-un-blue hover:bg-blue-100'
                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
          }`}
          title={section.enabled ? 'Hide section' : 'Show section'}
        >
          {section.enabled ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {section.fields.map((field) => (
          <FieldEditorRow
            key={field.id}
            field={field}
            draft={fieldDrafts[field.id] ?? { label: field.label, description: field.description || '', options: cloneOptions(field.options) }}
            disabled={updating || !section.enabled}
            onChange={(next) => onFieldDraftChange(field.id, next)}
            onSave={() => onSaveField(field)}
            onToggleEnabled={() => onToggleField(field)}
            onToggleRequired={() => onToggleRequired(field)}
            onMove={(direction) => onMoveField(field, direction)}
            onDelete={() => onDeleteField(field)}
          />
        ))}

        <AddFieldComposer
          draft={addDraft}
          disabled={updating || !section.enabled}
          open={addOpen}
          onOpen={onOpenAddField}
          onCancel={onCancelAddField}
          onChange={onAddDraftChange}
          onSubmit={onAddField}
        />
      </div>
    </div>
  );
}

export default function FormBuilder() {
  const { t } = useTranslation();
  const [sections, setSections] = useState<FormSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [sectionTitles, setSectionTitles] = useState<Record<string, string>>({});
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, FieldDraft>>({});
  const [addDrafts, setAddDrafts] = useState<Record<string, AddFieldDraft>>({});
  const [addOpen, setAddOpen] = useState<Record<string, boolean>>({});
  const [crisisEventId] = useState('default');

  const primeDrafts = useCallback((nextSections: FormSection[]) => {
    setSectionTitles(Object.fromEntries(nextSections.map((section) => [section.key, section.title])));
    setFieldDrafts(
      Object.fromEntries(
        nextSections.flatMap((section) =>
          section.fields.map((field) => [
            field.id,
            {
              label: field.label,
              description: field.description || '',
              options: cloneOptions(field.options),
            },
          ])
        )
      )
    );
    setAddDrafts((current) => {
      const next = { ...current };
      for (const section of nextSections) {
        next[section.key] = current[section.key] || defaultAddFieldDraft();
      }
      return next;
    });
  }, []);

  const applyPayload = useCallback((payload: { sections: FormSection[] }) => {
    const nextSections = [...payload.sections].sort((a, b) => a.order - b.order);
    setSections(nextSections);
    primeDrafts(nextSections);
  }, [primeDrafts]);

  const fetchForm = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getFormFields(crisisEventId) as { sections: FormSection[] };
      applyPayload(data);
    } finally {
      setLoading(false);
    }
  }, [applyPayload, crisisEventId]);

  useEffect(() => {
    const fetchId = scheduleTask(() => {
      fetchForm().catch(() => {});
    });
    return () => window.clearTimeout(fetchId);
  }, [fetchForm]);

  useEffect(() => {
    if (!statusMessage) return undefined;
    const timeoutId = window.setTimeout(() => setStatusMessage(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const updateSection = useCallback(async (sectionKey: string, data: Record<string, unknown>) => {
    setUpdatingKey(`section:${sectionKey}`);
    try {
      const response = await api.updateFormSection(crisisEventId, sectionKey, data) as { sections: FormSection[] };
      applyPayload(response);
      setStatusMessage({ tone: 'success', text: 'Saved.' });
    } catch (error) {
      setStatusMessage({ tone: 'error', text: 'Failed to save changes.' });
      throw error;
    } finally {
      setUpdatingKey(null);
    }
  }, [applyPayload, crisisEventId]);

  const updateField = useCallback(async (fieldId: string, data: Record<string, unknown>) => {
    setUpdatingKey(`field:${fieldId}`);
    try {
      const response = await api.updateFormField(crisisEventId, fieldId, data) as { sections: FormSection[] };
      applyPayload(response);
      setStatusMessage({ tone: 'success', text: 'Saved.' });
    } catch (error) {
      setStatusMessage({ tone: 'error', text: 'Failed to save changes.' });
      throw error;
    } finally {
      setUpdatingKey(null);
    }
  }, [applyPayload, crisisEventId]);

  const deleteField = useCallback(async (fieldId: string) => {
    setUpdatingKey(`field:${fieldId}`);
    try {
      const response = await api.deleteFormField(crisisEventId, fieldId) as { sections: FormSection[] };
      applyPayload(response);
      setStatusMessage({ tone: 'success', text: 'Saved.' });
    } catch (error) {
      setStatusMessage({ tone: 'error', text: 'Failed to save changes.' });
      throw error;
    } finally {
      setUpdatingKey(null);
    }
  }, [applyPayload, crisisEventId]);

  const createField = useCallback(async (sectionKey: string) => {
    const draft = addDrafts[sectionKey] || defaultAddFieldDraft();
    setUpdatingKey(`section:${sectionKey}`);
    try {
      const response = await api.createFormField(crisisEventId, {
        section: sectionKey,
        type: draft.type,
        label: draft.label,
        description: draft.description,
        required: draft.required,
        options: normalizeOptions(draft.options),
      }) as { sections: FormSection[] };
      applyPayload(response);
      setAddDrafts((current) => ({ ...current, [sectionKey]: defaultAddFieldDraft() }));
      setAddOpen((current) => ({ ...current, [sectionKey]: false }));
      setStatusMessage({ tone: 'success', text: 'Saved.' });
    } catch (error) {
      setStatusMessage({ tone: 'error', text: 'Failed to save changes.' });
      throw error;
    } finally {
      setUpdatingKey(null);
    }
  }, [addDrafts, applyPayload, crisisEventId]);

  const orderedSections = useMemo(() => [...sections].sort((a, b) => a.order - b.order), [sections]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('admin.form_builder.title', { defaultValue: 'Submission Flow' })}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {t('admin.form_builder.flow_help', { defaultValue: 'Manage the fields inside each fixed submission step. Step order is locked for the live report flow.' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {statusMessage && (
            <div
              className={`rounded-xl px-3 py-2 text-sm font-medium ${
                statusMessage.tone === 'success'
                  ? 'border border-green-200 bg-green-50 text-green-700'
                  : 'border border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {statusMessage.text}
            </div>
          )}
          <button
            type="button"
            onClick={fetchForm}
            disabled={loading}
            className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-50"
            aria-label={t('admin.common.refresh', { defaultValue: 'Refresh' })}
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading ? (
        <LoadingSpinner text={t('admin.form_builder.loading', { defaultValue: 'Loading submission flow...' })} />
      ) : (
        <div className="space-y-4">
          {orderedSections.map((section) => {
            const isUpdating = updatingKey?.startsWith(`section:${section.key}`) || updatingKey?.startsWith('field:');
            return (
              <SectionCard
                key={section.id}
                section={section}
                titleDraft={sectionTitles[section.key] ?? section.title}
                updating={Boolean(isUpdating)}
                fieldDrafts={fieldDrafts}
                addDraft={addDrafts[section.key] || defaultAddFieldDraft()}
                addOpen={Boolean(addOpen[section.key])}
                onTitleChange={(value) => setSectionTitles((current) => ({ ...current, [section.key]: value }))}
                onSaveTitle={() => updateSection(section.key, { title: sectionTitles[section.key] })}
                onToggleSection={() => updateSection(section.key, { enabled: !section.enabled })}
                onFieldDraftChange={(fieldId, next) => setFieldDrafts((current) => ({ ...current, [fieldId]: next }))}
                onSaveField={(field) => {
                  const draft = fieldDrafts[field.id] ?? {
                    label: field.label,
                    description: field.description || '',
                    options: cloneOptions(field.options),
                  };
                  updateField(field.id, {
                    label: draft.label,
                    description: draft.description,
                    options: CHOICE_TYPES.includes(field.type) ? normalizeOptions(draft.options) : undefined,
                  });
                }}
                onToggleField={(field) => updateField(field.id, { enabled: !field.enabled })}
                onToggleRequired={(field) => updateField(field.id, { required: !field.required })}
                onMoveField={(field, direction) => updateField(field.id, { direction })}
                onDeleteField={(field) => deleteField(field.id)}
                onAddDraftChange={(next) => setAddDrafts((current) => ({ ...current, [section.key]: next }))}
                onOpenAddField={() => setAddOpen((current) => ({ ...current, [section.key]: true }))}
                onCancelAddField={() => {
                  setAddOpen((current) => ({ ...current, [section.key]: false }));
                  setAddDrafts((current) => ({ ...current, [section.key]: defaultAddFieldDraft() }));
                }}
                onAddField={() => createField(section.key)}
              />
            );
          })}
          {orderedSections.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-400">
              {t('admin.form_builder.no_fields', { defaultValue: 'No submission sections found.' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
