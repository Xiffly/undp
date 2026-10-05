import express, { Request, Response } from 'express';
import { queryAll, queryOne, execute, executeBatch } from '../dbRuntime';
import { authMiddleware, requireRole } from '../middleware/auth';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, isSupportedLanguage } from '../utils/languages';
import {
  flattenLocale,
  deleteLocaleKeyEverywhere,
  getLocaleMissingKeys,
  getLocaleStaleKeys,
  getLocaleStatus,
  readLocaleKeyForEditor,
  readLocaleForEditor,
  readStoredLocale,
  saveLocaleKeyFromEditor,
  saveLocaleFromEditor,
  upsertLocaleKey,
} from '../utils/locales';
import { autoTranslateUiKey, autoTranslateUiLocale, UiTranslationError } from '../services/uiLocaleTranslation';

const router = express.Router();

type CoreFieldKey =
  | 'f_location'
  | 'f_infra_category'
  | 'f_infra_name'
  | 'f_crisis_type'
  | 'f_debris'
  | 'f_damage_level'
  | 'f_electricity'
  | 'f_health'
  | 'f_pressing_needs'
  | 'f_description'
  | 'f_photos';

type FormFieldKey = CoreFieldKey | `custom_${string}`;

type SupportedSectionKey =
  | 'location'
  | 'infrastructure'
  | 'damage'
  | 'impact'
  | 'photos';

type SupportedFieldDef = {
  key: CoreFieldKey;
  section: SupportedSectionKey;
  type: 'single_select' | 'multi_select' | 'text' | 'yesno' | 'radio' | 'section_header' | 'photo_upload';
  label: string;
  required: boolean;
  order: number;
  options?: { id: string; label: string; label_key?: string; order?: number }[];
  placeholder?: string;
  description?: string;
  max_length?: number;
  enabled: boolean;
  is_core: boolean;
};

type SupportedSectionDef = {
  key: SupportedSectionKey;
  labelKey: string;
  descriptionKey?: string;
  defaultLabel: string;
  defaultDescription?: string;
  order: number;
  enabled: boolean;
  canHide: boolean;
};

const SUPPORTED_SECTION_DEFS: SupportedSectionDef[] = [
  {
    key: 'location',
    labelKey: 'submit.location_title',
    descriptionKey: 'submit.location_subtitle',
    defaultLabel: 'Your Location',
    defaultDescription: 'Tap the map or use GPS to mark where the damage occurred.',
    order: 1,
    enabled: true,
    canHide: false,
  },
  {
    key: 'infrastructure',
    labelKey: 'submit.step_infrastructure',
    defaultLabel: 'Infrastructure',
    defaultDescription: 'Identify what was damaged and what kind of crisis caused it.',
    order: 2,
    enabled: true,
    canHide: true,
  },
  {
    key: 'damage',
    labelKey: 'submit.damage_title',
    descriptionKey: 'submit.damage_subtitle',
    defaultLabel: 'Damage & Crisis',
    defaultDescription: 'Capture the damage level, debris, and any visible impacts.',
    order: 3,
    enabled: true,
    canHide: false,
  },
  {
    key: 'impact',
    labelKey: 'submit.step_impact',
    defaultLabel: 'Community Impact',
    defaultDescription: 'Record how electricity, health services, and urgent needs are affected.',
    order: 4,
    enabled: true,
    canHide: true,
  },
  {
    key: 'photos',
    labelKey: 'submit.photos_title',
    descriptionKey: 'submit.photos_subtitle',
    defaultLabel: 'Photos & Submit',
    defaultDescription: 'Add photos, mark urgency, and send the report.',
    order: 5,
    enabled: true,
    canHide: true,
  },
];

const SUPPORTED_FIELD_DEFS: SupportedFieldDef[] = [
  {
    key: 'f_location',
    section: 'location',
    type: 'section_header',
    label: 'Location',
    required: true,
    order: 1,
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_infra_category',
    section: 'infrastructure',
    type: 'single_select',
    label: 'Type of Infrastructure',
    required: true,
    order: 2,
    options: [
      { id: 'residential', label: 'Residential Infrastructure (Houses and apartments)' },
      { id: 'commercial', label: 'Commercial Infrastructure (Markets, malls, shops, hotels, banks)' },
      { id: 'government', label: 'Government Building (Administrative buildings, courthouses, police stations)' },
      { id: 'utility', label: 'Utility Infrastructure (Water pumps, power plants, waste treatment)' },
      { id: 'transport', label: 'Transport and Communication Infrastructure (Roads, bridges, cell towers)' },
      { id: 'community', label: 'Community Infrastructure (Schools, hospitals, community halls)' },
      { id: 'public', label: 'Public / Recreation Infrastructure (Stadiums, playgrounds, religious buildings)' },
      { id: 'other', label: 'Other (please specify)' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_infra_name',
    section: 'infrastructure',
    type: 'text',
    label: 'Infrastructure Name / Details',
    required: false,
    order: 3,
    placeholder: 'e.g. Al Sabeen Hospital, Main Street Bridge',
    max_length: 200,
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_crisis_type',
    section: 'infrastructure',
    type: 'single_select',
    label: 'Nature of the Crisis',
    required: true,
    order: 4,
    options: [
      { id: 'earthquake', label: 'Earthquake' },
      { id: 'flood', label: 'Flood' },
      { id: 'tsunami', label: 'Tsunami' },
      { id: 'hurricane', label: 'Hurricane / Cyclone' },
      { id: 'wildfire', label: 'Wildfire' },
      { id: 'explosion', label: 'Explosion' },
      { id: 'chemical', label: 'Chemical Incident' },
      { id: 'conflict', label: 'Conflict' },
      { id: 'civil_unrest', label: 'Civil Unrest' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_debris',
    section: 'damage',
    type: 'yesno',
    label: 'Is there debris requiring clearing on or near the site?',
    required: false,
    order: 5,
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_damage_level',
    section: 'damage',
    type: 'single_select',
    label: 'Damage Level',
    required: true,
    order: 6,
    options: [
      { id: 'minimal', label: 'Minimal / No Damage - Structurally sound and functional' },
      { id: 'partial', label: 'Partially Damaged - Repairable, usable with caution' },
      { id: 'destroyed', label: 'Completely Damaged / Destroyed - Structurally unsafe' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_electricity',
    section: 'impact',
    type: 'radio',
    label: 'Condition of Electricity Infrastructure',
    required: true,
    order: 7,
    options: [
      { id: 'none', label: 'No damage observed' },
      { id: 'minor', label: 'Minor damage (service disruptions, quickly repairable)' },
      { id: 'moderate', label: 'Moderate damage (partial outages, repairs needed)' },
      { id: 'severe', label: 'Severe damage (major infrastructure damaged, prolonged outages)' },
      { id: 'destroyed', label: 'Completely destroyed (no electricity functioning)' },
      { id: 'unknown', label: 'Unknown / cannot be assessed' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_health',
    section: 'impact',
    type: 'radio',
    label: 'Overall Functioning of Health Services',
    required: true,
    order: 8,
    options: [
      { id: 'fully_functional', label: 'Fully functional' },
      { id: 'partially_functional', label: 'Partially functional' },
      { id: 'largely_disrupted', label: 'Largely disrupted' },
      { id: 'not_functioning', label: 'Not functioning at all' },
      { id: 'unknown', label: 'Unknown' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_pressing_needs',
    section: 'impact',
    type: 'multi_select',
    label: 'Most Pressing Needs',
    required: true,
    order: 9,
    options: [
      { id: 'food_water', label: 'Food assistance and safe drinking water' },
      { id: 'cash', label: 'Cash or financial assistance' },
      { id: 'healthcare', label: 'Access to healthcare and essential medicines' },
      { id: 'shelter', label: 'Shelter, housing repair, or temporary accommodation' },
      { id: 'livelihoods', label: 'Restoration of livelihoods or income sources' },
      { id: 'wash', label: 'Water, sanitation, and hygiene (toilets, washing facilities)' },
      { id: 'infrastructure', label: 'Restoration of basic services and infrastructure' },
      { id: 'protection', label: 'Protection services and psychosocial support' },
      { id: 'local_authority', label: 'Support from local authorities and community organizations' },
      { id: 'other', label: 'Other (please specify)' },
    ],
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_description',
    section: 'damage',
    type: 'text',
    label: 'Description',
    required: false,
    order: 10,
    placeholder: 'What happened? How many people are affected? Any urgent needs?',
    max_length: 500,
    enabled: true,
    is_core: true,
  },
  {
    key: 'f_photos',
    section: 'photos',
    type: 'section_header',
    label: 'Photos (up to 5)',
    required: false,
    order: 11,
    enabled: true,
    is_core: true,
  },
] as const;

const CORE_FIELD_LABEL_KEYS: Record<CoreFieldKey, string> = {
  f_location: 'submit.location_title',
  f_infra_category: 'submit.infra_title_label',
  f_infra_name: 'submit.infra_name_label',
  f_crisis_type: 'submit.crisis_title_label',
  f_debris: 'submit.debris_title',
  f_damage_level: 'submit.damage_level_label',
  f_electricity: 'submit.impact_title_elec_label',
  f_health: 'submit.impact_title_health_label',
  f_pressing_needs: 'submit.impact_title_needs_label',
  f_description: 'submit.description_label',
  f_photos: 'submit.photos_title',
};

const CORE_FIELD_OPTION_BASE_KEYS: Partial<Record<CoreFieldKey, string>> = {
  f_infra_category: 'submit.infra_title_options',
  f_crisis_type: 'submit.crisis_title_options',
  f_damage_level: 'submit.damage_level_options',
  f_electricity: 'submit.impact_title_elec_options',
  f_health: 'submit.impact_title_health_options',
  f_pressing_needs: 'submit.impact_title_needs_options',
};

const LEGACY_CORE_FIELD_LABEL_KEYS: Partial<Record<CoreFieldKey, string[]>> = {
  f_infra_category: ['submit.infra_title'],
  f_crisis_type: ['submit.crisis_title'],
  f_damage_level: ['submit.damage_title'],
  f_electricity: ['submit.impact_title_elec'],
  f_health: ['submit.impact_title_health'],
  f_pressing_needs: ['submit.impact_title_needs'],
};

const LEGACY_CORE_FIELD_OPTION_BASE_KEYS: Partial<Record<CoreFieldKey, string[]>> = {
  f_infra_category: ['submit.infra_title'],
  f_crisis_type: ['submit.crisis_title'],
  f_damage_level: ['submit.damage_title'],
  f_electricity: ['submit.impact_title_elec'],
  f_health: ['submit.impact_title_health'],
  f_pressing_needs: ['submit.impact_title_needs'],
};

const SUPPORTED_FIELD_KEYS = new Set<CoreFieldKey>(SUPPORTED_FIELD_DEFS.map((field) => field.key));
const SUPPORTED_SECTION_KEYS = new Set<SupportedSectionKey>(SUPPORTED_SECTION_DEFS.map((section) => section.key));
const NON_HIDEABLE_FIELD_KEYS = new Set<CoreFieldKey>(['f_location', 'f_damage_level']);
const NON_HIDEABLE_SECTION_KEYS = new Set<SupportedSectionKey>(
  SUPPORTED_SECTION_DEFS.filter((section) => !section.canHide).map((section) => section.key)
);

interface FormField {
  id: string;
  key: FormFieldKey;
  label_key: string;
  description_key?: string;
  type: 'single_select' | 'multi_select' | 'text' | 'yesno' | 'radio' | 'section_header' | 'photo_upload';
  label: string;
  description?: string;
  required: boolean;
  order: number;
  options?: { id: string; label: string; label_key?: string; order?: number }[];
  placeholder?: string;
  max_length?: number;
  enabled: boolean;
  deleted?: boolean;
  is_core: boolean;
  crisis_event_id: string;
  section: SupportedSectionKey;
  removable: boolean;
}

interface FormSection {
  id: string;
  key: SupportedSectionKey;
  label_key: string;
  title: string;
  description_key?: string;
  description?: string;
  order: number;
  enabled: boolean;
  can_hide: boolean;
  crisis_event_id: string;
  fields: FormField[];
}

executeBatch(`
  CREATE TABLE IF NOT EXISTS form_fields (
    id TEXT PRIMARY KEY,
    crisis_event_id TEXT NOT NULL DEFAULT 'default',
    section_key TEXT NOT NULL DEFAULT 'location',
    type TEXT NOT NULL,
    label_key TEXT,
    description_key TEXT,
    label TEXT NOT NULL,
    description TEXT,
    required INTEGER NOT NULL DEFAULT 1,
    field_order INTEGER NOT NULL DEFAULT 0,
    options TEXT DEFAULT '[]',
    placeholder TEXT,
    max_length INTEGER DEFAULT 500,
    enabled INTEGER NOT NULL DEFAULT 1,
    deleted INTEGER NOT NULL DEFAULT 0,
    is_core INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS section_key TEXT DEFAULT 'location';
  ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS label_key TEXT;
  ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS description_key TEXT;
  ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS description TEXT;
  ALTER TABLE form_fields ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX IF NOT EXISTS idx_form_crisis ON form_fields(crisis_event_id);
  CREATE INDEX IF NOT EXISTS idx_form_order ON form_fields(field_order);
  CREATE TABLE IF NOT EXISTS form_sections (
    id TEXT PRIMARY KEY,
    crisis_event_id TEXT NOT NULL DEFAULT 'default',
    section_key TEXT NOT NULL,
    section_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_form_sections_crisis ON form_sections(crisis_event_id);
  CREATE INDEX IF NOT EXISTS idx_form_sections_order ON form_sections(section_order);
`);

function getStoredFieldId(fieldKey: FormFieldKey | string, crisisEventId: string) {
  return `${fieldKey}_${crisisEventId}`;
}

function getStoredSectionId(sectionKey: SupportedSectionKey, crisisEventId: string) {
  return `${sectionKey}_${crisisEventId}`;
}

function normalizeFieldKey(fieldId: string, crisisEventId: string) {
  const suffix = `_${crisisEventId}`;
  return fieldId.endsWith(suffix) ? fieldId.slice(0, -suffix.length) : fieldId;
}

function isSupportedFieldKey(value: string): value is CoreFieldKey {
  return SUPPORTED_FIELD_KEYS.has(value as CoreFieldKey);
}

function isSupportedSectionKey(value: string): value is SupportedSectionKey {
  return SUPPORTED_SECTION_KEYS.has(value as SupportedSectionKey);
}

function isCustomFieldKey(value: string): value is `custom_${string}` {
  return value.startsWith('custom_');
}

function getCoreFieldLabelKey(fieldKey: CoreFieldKey) {
  return CORE_FIELD_LABEL_KEYS[fieldKey];
}

function getCoreFieldOptionBaseKey(fieldKey: CoreFieldKey) {
  return CORE_FIELD_OPTION_BASE_KEYS[fieldKey] || getCoreFieldLabelKey(fieldKey);
}

function slugifyLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'field';
}

function generateCustomFieldKey(label: string): `custom_${string}` {
  return `custom_${slugifyLabel(label)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getCustomFieldLabelKey(section: SupportedSectionKey, fieldKey: `custom_${string}`) {
  return `submit.dynamic.${section}.${fieldKey}.label`;
}

function getCustomFieldDescriptionKey(section: SupportedSectionKey, fieldKey: `custom_${string}`) {
  return `submit.dynamic.${section}.${fieldKey}.description`;
}

function getOptionLabelKey(baseKey: string, optionId: string) {
  return `${baseKey}.options.${optionId}.label`;
}

function ensureEnglishLocaleKey(key: string, fallbackValue: string) {
  const existingFlat = flattenLocale(readStoredLocale(DEFAULT_LANGUAGE));
  if (!String(existingFlat[key] ?? '').trim()) {
    upsertLocaleKey(DEFAULT_LANGUAGE, key, fallbackValue);
  }
}

function migrateLocaleLeafKey(oldKey: string, nextKey: string) {
  for (const lang of SUPPORTED_LANGUAGE_CODES) {
    const localeFlat = flattenLocale(readStoredLocale(lang));
    const previousValue = localeFlat[oldKey];
    const currentValue = localeFlat[nextKey];
    if (typeof previousValue === 'string' && String(previousValue).trim() && !String(currentValue ?? '').trim()) {
      upsertLocaleKey(lang, nextKey, previousValue);
    }
  }
}

function readLocaleKeySafely(lang: string, key: string | undefined, fallbackValue: string) {
  if (!key) return fallbackValue;
  try {
    const localized = readLocaleKeyForEditor(lang, key).value;
    return String(localized || fallbackValue || '');
  } catch {
    return fallbackValue;
  }
}

type FormFieldOption = { id: string; label: string; label_key?: string; order?: number };

function normalizeFieldOptions(options: unknown, baseKey: string): FormFieldOption[] {
  if (!Array.isArray(options)) return [];
  const normalized = options
    .map((option: any, index: number) => {
      const id = String(option?.id || `option_${index + 1}`);
      const label = String(option?.label || '').trim();
      if (!label) return null;
      return {
        id,
        label,
        label_key: String(option?.label_key || getOptionLabelKey(baseKey, id)),
        order: typeof option?.order === 'number' ? option.order : index + 1,
      };
    })
    .filter(Boolean) as FormFieldOption[];

  return normalized
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((option, index) => ({ ...option, order: index + 1 }));
}

function syncOptionLocaleKeys(
  previousOptions: FormFieldOption[],
  nextOptions: FormFieldOption[]
) {
  const previousKeys = new Set(previousOptions.map((option) => option.label_key).filter(Boolean) as string[]);
  const nextKeys = new Set(nextOptions.map((option) => option.label_key).filter(Boolean) as string[]);

  for (const option of nextOptions) {
    if (!option.label_key) continue;
    upsertLocaleKey(DEFAULT_LANGUAGE, option.label_key, option.label);
  }

  for (const previousKey of previousKeys) {
    if (!nextKeys.has(previousKey)) {
      deleteLocaleKeyEverywhere(previousKey);
    }
  }
}

async function cleanupUnsupportedFields(crisisEventId: string = 'default') {
  const rows = await queryAll<{ id: string; is_core: number }>(
    'SELECT id, is_core FROM form_fields WHERE crisis_event_id = ?',
    [crisisEventId]
  );

  for (const row of rows) {
    const fieldKey = normalizeFieldKey(row.id, crisisEventId);
    if (row.is_core && !isSupportedFieldKey(fieldKey)) {
      await execute('DELETE FROM form_fields WHERE id = ?', [row.id]);
    }
  }
}

async function cleanupUnsupportedSections(crisisEventId: string = 'default') {
  const rows = await queryAll<{ id: string; section_key: string }>(
    'SELECT id, section_key FROM form_sections WHERE crisis_event_id = ?',
    [crisisEventId]
  );

  for (const row of rows) {
    if (!isSupportedSectionKey(row.section_key)) {
      await execute('DELETE FROM form_sections WHERE id = ?', [row.id]);
    }
  }
}

async function seedDefaultFields(crisisEventId: string = 'default') {
  await cleanupUnsupportedFields(crisisEventId);
  await cleanupUnsupportedSections(crisisEventId);

  // The database stores per-event overrides, but the core field catalog remains code-owned so every
  // deployment starts from a valid submission contract before editors customize it.
  for (const field of SUPPORTED_FIELD_DEFS) {
    for (const legacyKey of LEGACY_CORE_FIELD_LABEL_KEYS[field.key] || []) {
      migrateLocaleLeafKey(legacyKey, getCoreFieldLabelKey(field.key));
    }
    ensureEnglishLocaleKey(getCoreFieldLabelKey(field.key), field.label);
    for (const option of field.options || []) {
      const canonicalOptionKey = getOptionLabelKey(getCoreFieldOptionBaseKey(field.key), option.id);
      for (const legacyBaseKey of LEGACY_CORE_FIELD_OPTION_BASE_KEYS[field.key] || []) {
        migrateLocaleLeafKey(getOptionLabelKey(legacyBaseKey, option.id), canonicalOptionKey);
      }
      ensureEnglishLocaleKey(canonicalOptionKey, option.label);
    }
  }

  for (const section of SUPPORTED_SECTION_DEFS) {
    ensureEnglishLocaleKey(section.labelKey, section.defaultLabel);
    if (section.descriptionKey && section.defaultDescription) {
      ensureEnglishLocaleKey(section.descriptionKey, section.defaultDescription);
    }
  }

  for (const section of SUPPORTED_SECTION_DEFS) {
    await execute(
      `INSERT INTO form_sections
      (id, crisis_event_id, section_key, section_order, enabled)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`,
      [
        getStoredSectionId(section.key, crisisEventId),
        crisisEventId,
        section.key,
        section.order,
        section.enabled ? 1 : 0,
      ]
    );
  }

  for (const field of SUPPORTED_FIELD_DEFS) {
    await execute(
      `INSERT INTO form_fields
      (id, crisis_event_id, section_key, type, label_key, label, required, field_order, options, placeholder, max_length, enabled, is_core)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO NOTHING`,
      [
        getStoredFieldId(field.key, crisisEventId),
        crisisEventId,
        field.section,
        field.type,
        getCoreFieldLabelKey(field.key),
        field.label,
        field.required ? 1 : 0,
        field.order,
        JSON.stringify(field.options || []),
        field.placeholder || null,
        field.max_length || 500,
        field.enabled ? 1 : 0,
        field.is_core ? 1 : 0,
      ]
    );

    await execute(
      `UPDATE form_fields
       SET
         crisis_event_id = COALESCE(crisis_event_id, ?),
         section_key = CASE WHEN section_key IS NULL OR trim(section_key) = '' THEN ? ELSE section_key END,
         label_key = CASE WHEN label_key IS NULL OR trim(label_key) = '' THEN ? ELSE label_key END,
         placeholder = COALESCE(placeholder, ?),
         max_length = COALESCE(max_length, ?),
         is_core = COALESCE(is_core, ?),
         type = COALESCE(type, ?),
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        crisisEventId,
        field.section,
        getCoreFieldLabelKey(field.key),
        field.placeholder || null,
        field.max_length || 500,
        field.is_core ? 1 : 0,
        field.type,
        getStoredFieldId(field.key, crisisEventId),
      ]
    );

    for (const legacyKey of LEGACY_CORE_FIELD_LABEL_KEYS[field.key] || []) {
      await execute(
        `UPDATE form_fields
         SET label_key = ?, updated_at = datetime('now')
         WHERE id = ? AND label_key = ?`,
        [
          getCoreFieldLabelKey(field.key),
          getStoredFieldId(field.key, crisisEventId),
          legacyKey,
        ]
      );
    }

    const existingOptionsRow = await queryOne<{ options: string | null }>(
      'SELECT options FROM form_fields WHERE id = ? AND crisis_event_id = ?',
      [getStoredFieldId(field.key, crisisEventId), crisisEventId]
    );
    const existingOptions = JSON.parse(existingOptionsRow?.options || '[]') as FormFieldOption[];
    if (existingOptions.length > 0) {
      const normalizedOptions = existingOptions.map((option, index) => {
        const optionId = String(option.id || `option_${index + 1}`);
        return {
          ...option,
          id: optionId,
          label_key: String(option.label_key || getOptionLabelKey(getCoreFieldOptionBaseKey(field.key), optionId)),
          order: typeof option.order === 'number' ? option.order : index + 1,
        };
      });
      const hasLegacyOptionKey = normalizedOptions.some((option) => {
        const legacyKeys = (LEGACY_CORE_FIELD_OPTION_BASE_KEYS[field.key] || []).map((baseKey) => getOptionLabelKey(baseKey, option.id));
        return !option.label_key || legacyKeys.includes(String(option.label_key));
      });
      if (hasLegacyOptionKey) {
        const migratedOptions = normalizedOptions.map((option) => ({
          ...option,
          label_key: getOptionLabelKey(getCoreFieldOptionBaseKey(field.key), option.id),
        }));
        await execute(
          "UPDATE form_fields SET options = ?, updated_at = datetime('now') WHERE id = ?",
          [JSON.stringify(migratedOptions), getStoredFieldId(field.key, crisisEventId)]
        );
      }
    }
  }
}

seedDefaultFields('default').catch(() => {});

function formatField(f: any, lang: string = DEFAULT_LANGUAGE): FormField {
  const normalizedKey = normalizeFieldKey(f.id, f.crisis_event_id) as FormFieldKey;
  const canonicalLabelKey = isSupportedFieldKey(normalizedKey) ? getCoreFieldLabelKey(normalizedKey) : '';
  const labelKey = String(f.label_key || canonicalLabelKey || '');
  const normalizedLabelKey = isSupportedFieldKey(normalizedKey) && (LEGACY_CORE_FIELD_LABEL_KEYS[normalizedKey] || []).includes(labelKey)
    ? canonicalLabelKey
    : labelKey;
  const optionBaseKey = isSupportedFieldKey(normalizedKey) ? getCoreFieldOptionBaseKey(normalizedKey) : labelKey;
  const descriptionKey = String(f.description_key || '');
  const localizedLabel = readLocaleKeySafely(lang, normalizedLabelKey, String(f.label || ''));
  const localizedDescription = readLocaleKeySafely(lang, descriptionKey, String(f.description || ''));
  const parsedOptions = (JSON.parse(f.options || '[]') as FormFieldOption[]).map((option, index) => ({
    ...option,
    label_key: String(option.label_key || getOptionLabelKey(optionBaseKey, String(option.id || `option_${index + 1}`))),
    label: readLocaleKeySafely(lang, String(option.label_key || getOptionLabelKey(optionBaseKey, String(option.id || `option_${index + 1}`))), String(option.label || '')),
    order: typeof option.order === 'number' ? option.order : index + 1,
  }));
  return {
    ...f,
    key: normalizedKey,
    label_key: normalizedLabelKey,
    description_key: descriptionKey || undefined,
    options: parsedOptions,
    required: Boolean(f.required),
    enabled: Boolean(f.enabled),
    deleted: Boolean(f.deleted),
    is_core: Boolean(f.is_core),
    order: f.field_order,
    crisis_event_id: f.crisis_event_id,
    label: localizedLabel || String(f.label || ''),
    description: localizedDescription || String(f.description || ''),
    section: (f.section_key || SUPPORTED_FIELD_DEFS.find((field) => field.key === normalizedKey)?.section || 'location') as SupportedSectionKey,
    removable: !f.is_core || !NON_HIDEABLE_FIELD_KEYS.has(normalizedKey as CoreFieldKey),
  };
}

function formatSection(sectionRow: any, fields: FormField[], lang: string = DEFAULT_LANGUAGE): FormSection {
  const sectionDef = SUPPORTED_SECTION_DEFS.find((section) => section.key === sectionRow.section_key);
  const title = sectionDef
    ? readLocaleKeySafely(lang, sectionDef.labelKey, sectionDef.defaultLabel)
    : sectionRow.section_key;
  const description = sectionDef?.descriptionKey
    ? readLocaleKeySafely(lang, sectionDef.descriptionKey, sectionDef.defaultDescription || '')
    : sectionDef?.defaultDescription;

  return {
    id: sectionRow.id,
    key: sectionRow.section_key,
    label_key: sectionDef?.labelKey || '',
    title,
    description_key: sectionDef?.descriptionKey,
    description,
    order: sectionRow.section_order,
    enabled: Boolean(sectionRow.enabled),
    can_hide: sectionDef ? sectionDef.canHide : true,
    crisis_event_id: sectionRow.crisis_event_id,
    fields,
  };
}

async function loadSectionPayload(crisisEventId: string, publicOnly = false, lang: string = DEFAULT_LANGUAGE) {
  await seedDefaultFields(crisisEventId);
  const sectionRows = await queryAll(
    'SELECT * FROM form_sections WHERE crisis_event_id = ? ORDER BY section_order ASC',
    [crisisEventId]
  );
  const enabledSectionKeys = new Set(
    sectionRows.filter((row: any) => Boolean(row.enabled)).map((row: any) => row.section_key)
  );
  const fieldRows = await queryAll(
    `SELECT * FROM form_fields WHERE crisis_event_id = ? AND deleted = 0 ${publicOnly ? 'AND enabled = 1' : ''} ORDER BY field_order ASC`,
    [crisisEventId]
  );
  const fields = fieldRows
    .map((field) => formatField(field, lang))
    .filter((field) => !publicOnly || enabledSectionKeys.has(field.section));
  const sections = sectionRows
    .map((sectionRow: any) => {
      const sectionFields = fields.filter((field) => field.section === sectionRow.section_key);
      return formatSection(sectionRow, sectionFields, lang);
    })
    // Public consumers should never see disabled sections or empty editor scaffolding.
    .filter((section) => !publicOnly || (section.enabled && section.fields.length > 0));

  return { sections, fields };
}

router.get('/translations/:lang', authMiddleware, requireRole('team_lead'), (req: Request, res: Response): void => {
  const { lang } = req.params;
  if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) { res.status(400).json({ error: 'Invalid language' }); return; }
  try {
    res.json({
      locale: readLocaleForEditor(lang),
      staleKeys: lang === DEFAULT_LANGUAGE ? [] : getLocaleStaleKeys(lang),
      missingKeys: lang === DEFAULT_LANGUAGE ? [] : getLocaleMissingKeys(lang),
    });
  } catch {
    res.status(500).json({ error: 'Failed to read translation file' });
  }
});

router.put('/translations/:lang', authMiddleware, requireRole('team_lead'), (req: Request, res: Response): void => {
  const { lang } = req.params;
  if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) { res.status(400).json({ error: 'Invalid language' }); return; }
  try {
    saveLocaleFromEditor(lang, req.body || {});
    res.json({ success: true });
  } catch (err: any) {
    console.error('Translation file save failed:', err);
    res.status(500).json({ error: 'Failed to save translation file' });
  }
});

router.patch('/translations/:lang/key', authMiddleware, requireRole('team_lead'), (req: Request, res: Response): void => {
  const { lang } = req.params;
  const key = String(req.body?.key || '').trim();
  if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) { res.status(400).json({ error: 'Invalid language' }); return; }
  if (!key) { res.status(400).json({ error: 'Translation key is required' }); return; }
  try {
    const saved = saveLocaleKeyFromEditor(lang, key, req.body?.value);
    res.json({ success: true, key: saved.key, value: saved.value });
  } catch (err: any) {
    console.error('Translation key save failed:', err);
    res.status(400).json({ error: 'Failed to save translation key' });
  }
});

router.get('/translations', authMiddleware, requireRole('team_lead'), (_req: Request, res: Response): void => {
  res.json({ languages: getLocaleStatus() });
});

router.post('/translations/:lang/auto-translate', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { lang } = req.params;
  const allowed = SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE);
  if (!allowed.includes(lang)) { res.status(400).json({ error: 'Can only auto-translate non-English languages' }); return; }
  try {
    const result = await autoTranslateUiLocale(lang);
    res.json({
      success: true,
      updated: result.updated,
      total: result.total,
      provider: result.provider,
      model: result.model,
      note: 'Draft translations were generated with OpenRouter. Review and save curated edits before shipping.',
    });
  } catch (err: any) {
    if (err instanceof UiTranslationError) {
      res.status(err.status).json({ error: err.uiMessage, retryable: err.retryable });
      return;
    }
    res.status(500).json({ error: 'AI translation is currently unavailable. Please try again later.' });
  }
});

router.post('/translations/:lang/auto-translate-key', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { lang } = req.params;
  const key = String(req.body?.key || '').trim();
  const allowed = SUPPORTED_LANGUAGE_CODES.filter((code) => code !== DEFAULT_LANGUAGE);
  if (!allowed.includes(lang)) { res.status(400).json({ error: 'Can only auto-translate non-English languages' }); return; }
  if (!key) { res.status(400).json({ error: 'Translation key is required' }); return; }
  try {
    const { source } = readLocaleKeyForEditor(DEFAULT_LANGUAGE, key);
    const result = await autoTranslateUiKey(lang, key, source);
    res.json({
      success: true,
      key,
      source,
      value: result.value,
      provider: result.provider,
      model: result.model,
      note: 'Draft translation generated with OpenRouter. Review before saving.',
    });
  } catch (err: any) {
    if (err instanceof UiTranslationError) {
      res.status(err.status).json({ error: err.uiMessage, retryable: err.retryable });
      return;
    }
    res.status(500).json({ error: 'AI translation is currently unavailable. Please try again later.' });
  }
});

router.get('/:crisisEventId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId } = req.params;
  res.json(await loadSectionPayload(crisisEventId));
});

router.get('/:crisisEventId/public', async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId } = req.params;
  const requestedLang = typeof req.query.lang === 'string' ? req.query.lang : DEFAULT_LANGUAGE;
  const lang = isSupportedLanguage(requestedLang) ? requestedLang : DEFAULT_LANGUAGE;
  res.json(await loadSectionPayload(crisisEventId, true, lang));
});

router.patch('/:crisisEventId/sections/:sectionKey', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId, sectionKey } = req.params;
  const { enabled, title } = req.body || {};
  if (!isSupportedSectionKey(sectionKey)) { res.status(400).json({ error: 'Unsupported section' }); return; }

  await seedDefaultFields(crisisEventId);
  const sectionId = getStoredSectionId(sectionKey, crisisEventId);
  const sectionRow = await queryOne<any>('SELECT * FROM form_sections WHERE id = ? AND crisis_event_id = ?', [sectionId, crisisEventId]);
  if (!sectionRow) { res.status(404).json({ error: 'Section not found' }); return; }

  if (typeof enabled === 'boolean') {
    if (NON_HIDEABLE_SECTION_KEYS.has(sectionKey) && enabled === false) {
      res.status(400).json({ error: 'This section is required by the live submission flow and cannot be hidden' });
      return;
    }

    await execute('UPDATE form_sections SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?', [enabled ? 1 : 0, sectionId]);
  }

  if (typeof title === 'string') {
    const sectionDef = SUPPORTED_SECTION_DEFS.find((section) => section.key === sectionKey);
    if (!sectionDef) { res.status(400).json({ error: 'Unsupported section' }); return; }
    saveLocaleKeyFromEditor(DEFAULT_LANGUAGE, sectionDef.labelKey, title);
  }

  res.json(await loadSectionPayload(crisisEventId));
});

router.post('/:crisisEventId/fields', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId } = req.params;
  const { section, type, label, description, required, options } = req.body || {};
  if (!isSupportedSectionKey(String(section || ''))) {
    res.status(400).json({ error: 'Unsupported section' }); return;
  }
  const safeType = String(type || '').trim();
  const supportedTypes = new Set(['text', 'yesno', 'single_select', 'multi_select', 'radio', 'photo_upload']);
  if (!supportedTypes.has(safeType)) {
    res.status(400).json({ error: 'Unsupported field type' }); return;
  }
  const safeLabel = String(label || '').trim().slice(0, 120);
  const safeDescription = String(description || '').trim().slice(0, 240);
  if (!safeLabel) {
    res.status(400).json({ error: 'Field label is required' }); return;
  }

  const sectionRows = await queryAll<any>('SELECT * FROM form_fields WHERE crisis_event_id = ? AND section_key = ? AND deleted = 0 ORDER BY field_order ASC', [crisisEventId, section]);
  const nextOrder = sectionRows.length > 0 ? Math.max(...sectionRows.map((row) => Number(row.field_order || 0))) + 1 : 1;
  const fieldKey = generateCustomFieldKey(safeLabel);
  const fieldId = getStoredFieldId(fieldKey, crisisEventId);
  const labelKey = getCustomFieldLabelKey(section, fieldKey);
  const descriptionKey = getCustomFieldDescriptionKey(section, fieldKey);
  const normalizedOptions = normalizeFieldOptions(options, labelKey);

  upsertLocaleKey(DEFAULT_LANGUAGE, labelKey, safeLabel);
  upsertLocaleKey(DEFAULT_LANGUAGE, descriptionKey, safeDescription);
  syncOptionLocaleKeys([], normalizedOptions);
  await execute(
    `INSERT INTO form_fields
      (id, crisis_event_id, section_key, type, label_key, description_key, label, description, required, field_order, options, placeholder, max_length, enabled, is_core)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fieldId,
      crisisEventId,
      section,
      safeType,
      labelKey,
      descriptionKey,
      safeLabel,
      safeDescription,
      required === false ? 0 : 1,
      nextOrder,
      JSON.stringify(normalizedOptions),
      null,
      500,
      1,
      0,
    ]
  );

  res.status(201).json(await loadSectionPayload(crisisEventId));
});

router.patch('/:crisisEventId/:fieldId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId, fieldId } = req.params;
  const { enabled, required, label, description, direction, options } = req.body || {};
  const field = await queryOne<any>('SELECT * FROM form_fields WHERE id = ? AND crisis_event_id = ?', [fieldId, crisisEventId]);
  if (!field) { res.status(404).json({ error: 'Field not found' }); return; }

  const fieldKey = normalizeFieldKey(field.id, crisisEventId) as FormFieldKey;
  if (!isSupportedFieldKey(fieldKey) && !isCustomFieldKey(fieldKey)) { res.status(400).json({ error: 'Unsupported field' }); return; }
  const canonicalLabelKey = isSupportedFieldKey(fieldKey) ? getCoreFieldLabelKey(fieldKey) : getCustomFieldLabelKey(field.section_key, fieldKey as `custom_${string}`);
  const storedLabelKey = String(field.label_key || canonicalLabelKey);
  const labelKey = isSupportedFieldKey(fieldKey) && (LEGACY_CORE_FIELD_LABEL_KEYS[fieldKey] || []).includes(storedLabelKey)
    ? canonicalLabelKey
    : storedLabelKey;
  const optionBaseKey = isSupportedFieldKey(fieldKey) ? getCoreFieldOptionBaseKey(fieldKey) : labelKey;
  const descriptionKey = String(field.description_key || (isCustomFieldKey(fieldKey) ? getCustomFieldDescriptionKey(field.section_key, fieldKey) : ''));

  if (typeof enabled === 'boolean') {
    if (isSupportedFieldKey(fieldKey) && NON_HIDEABLE_FIELD_KEYS.has(fieldKey) && enabled === false) {
      res.status(400).json({ error: 'This field is required by the live report flow and cannot be hidden' });
      return;
    }
    await execute("UPDATE form_fields SET enabled = ?, updated_at = datetime('now') WHERE id = ?", [enabled ? 1 : 0, fieldId]);
  }

  if (typeof required === 'boolean') {
    await execute("UPDATE form_fields SET required = ?, updated_at = datetime('now') WHERE id = ?", [required ? 1 : 0, fieldId]);
  }

  if (typeof label === 'string') {
    const safeLabel = label.trim().slice(0, 120);
    if (!safeLabel) { res.status(400).json({ error: 'Field label is required' }); return; }
    upsertLocaleKey(DEFAULT_LANGUAGE, labelKey, safeLabel);
    await execute("UPDATE form_fields SET label = ?, label_key = ?, updated_at = datetime('now') WHERE id = ?", [safeLabel, labelKey, fieldId]);
  }

  if (typeof description === 'string' && descriptionKey) {
    const safeDescription = description.trim().slice(0, 240);
    upsertLocaleKey(DEFAULT_LANGUAGE, descriptionKey, safeDescription);
    await execute("UPDATE form_fields SET description = ?, description_key = ?, updated_at = datetime('now') WHERE id = ?", [safeDescription, descriptionKey, fieldId]);
  }

  if (Array.isArray(options)) {
    const previousOptions = JSON.parse(field.options || '[]') as FormFieldOption[];
    const normalizedOptions = normalizeFieldOptions(options, optionBaseKey);
    syncOptionLocaleKeys(previousOptions, normalizedOptions);
    await execute("UPDATE form_fields SET options = ?, updated_at = datetime('now') WHERE id = ?", [JSON.stringify(normalizedOptions), fieldId]);
  }

  if (direction === 'up' || direction === 'down') {
    const sectionFields = await queryAll<any>(
      'SELECT * FROM form_fields WHERE crisis_event_id = ? AND section_key = ? AND deleted = 0 ORDER BY field_order ASC',
      [crisisEventId, field.section_key]
    );
    const index = sectionFields.findIndex((row: any) => row.id === fieldId);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (index >= 0 && swapIndex >= 0 && swapIndex < sectionFields.length) {
      const current = sectionFields[index];
      const target = sectionFields[swapIndex];
      await execute("UPDATE form_fields SET field_order = ?, updated_at = datetime('now') WHERE id = ?", [target.field_order, current.id]);
      await execute("UPDATE form_fields SET field_order = ?, updated_at = datetime('now') WHERE id = ?", [current.field_order, target.id]);
    }
  }

  res.json(await loadSectionPayload(crisisEventId));
});

router.delete('/:crisisEventId/:fieldId', authMiddleware, requireRole('team_lead'), async (req: Request, res: Response): Promise<void> => {
  const { crisisEventId, fieldId } = req.params;
  const field = await queryOne<any>('SELECT * FROM form_fields WHERE id = ? AND crisis_event_id = ?', [fieldId, crisisEventId]);
  if (!field) { res.status(404).json({ error: 'Field not found' }); return; }

  const fieldKey = normalizeFieldKey(field.id, crisisEventId) as FormFieldKey;
  if (isSupportedFieldKey(fieldKey) && NON_HIDEABLE_FIELD_KEYS.has(fieldKey)) {
    res.status(400).json({ error: 'This field is required by the live report flow and cannot be deleted' }); return;
  }

  if (field.is_core) {
    await execute("UPDATE form_fields SET deleted = 1, enabled = 0, updated_at = datetime('now') WHERE id = ?", [fieldId]);
  } else {
    await execute('DELETE FROM form_fields WHERE id = ?', [fieldId]);
  }
  if (!field.is_core && field.label_key) {
    deleteLocaleKeyEverywhere(String(field.label_key));
  }
  if (!field.is_core && field.description_key) {
    deleteLocaleKeyEverywhere(String(field.description_key));
  }
  for (const option of JSON.parse(field.options || '[]') as FormFieldOption[]) {
    if (option.label_key) {
      deleteLocaleKeyEverywhere(String(option.label_key));
    }
  }

  res.json(await loadSectionPayload(crisisEventId));
});

export default router;
