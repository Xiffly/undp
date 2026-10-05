

export type FormFieldKey =
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
  | 'f_photos'
  | `custom_${string}`;

export type PublicFormField = {
  id: string;
  key: FormFieldKey;
  label_key: string;
  description_key?: string;
  label: string;
  description?: string;
  section: PublicFormSection['key'];
  type: 'single_select' | 'multi_select' | 'text' | 'yesno' | 'radio' | 'section_header' | 'photo_upload';
  required: boolean;
  order: number;
  options: { id: string; label: string }[];
  placeholder?: string;
  enabled: boolean;
  removable?: boolean;
};

export type PublicFormSection = {
  id: string;
  key: 'location' | 'infrastructure' | 'damage' | 'impact' | 'photos';
  label_key: string;
  title?: string;
  description?: string;
  enabled: boolean;
  order?: number;
  fields: PublicFormField[];
};

export const FIELD_SECTION_MAP: Record<FormFieldKey, PublicFormSection['key']> = {
  f_location: 'location',
  f_infra_category: 'infrastructure',
  f_infra_name: 'infrastructure',
  f_crisis_type: 'infrastructure',
  f_debris: 'damage',
  f_damage_level: 'damage',
  f_electricity: 'impact',
  f_health: 'impact',
  f_pressing_needs: 'impact',
  f_description: 'damage',
  f_photos: 'photos',
};

export const DEFAULT_SECTION_DEFS: PublicFormSection[] = [
  { id: 'location_default', key: 'location', label_key: 'submit.location_title', title: 'Your Location', description: 'Tap the map or use GPS to mark where the damage occurred.', enabled: true, fields: [] },
  { id: 'infrastructure_default', key: 'infrastructure', label_key: 'submit.step_infrastructure', title: 'Infrastructure', description: 'Identify what was damaged and what kind of crisis caused it.', enabled: true, fields: [] },
  { id: 'damage_default', key: 'damage', label_key: 'submit.damage_title', title: 'Damage & Crisis', description: 'Capture the damage level, debris, and any visible impacts.', enabled: true, fields: [] },
  { id: 'impact_default', key: 'impact', label_key: 'submit.step_impact', title: 'Community Impact', description: 'Record how electricity, health services, and urgent needs are affected.', enabled: true, fields: [] },
  { id: 'photos_default', key: 'photos', label_key: 'submit.photos_title', title: 'Photos & Submit', description: 'Add photos, mark urgency, and send the report.', enabled: true, fields: [] },
] as const;

export function isCustomFieldKey(value: string): value is `custom_${string}` {
  return value.startsWith('custom_');
}

export function createFallbackSections(): PublicFormSection[] {
  return (DEFAULT_SECTION_DEFS as PublicFormSection[]).map((section) => ({
    ...section,
    fields: Object.entries(FIELD_SECTION_MAP)
      .filter(([, sectionKey]) => sectionKey === section.key)
      .map(([key], index) => ({
        id: `${key}_default`,
        key: key as FormFieldKey,
        label_key: '',
        label: '',
        section: section.key,
        type: 'text',
        required: false,
        order: index + 1,
        options: [],
        enabled: true,
      })),
  }));
}

export const emptyForm = {
  lat: 0,
  lng: 0,
  address_text: '',
  building_label: '',
  location_capture_mode: 'unknown',
  footprint_set_id: '',
  footprint_feature_id: '',
  footprint_feature_key: '',
  infra_category: '',
  infra_name: '',
  crisis_type: '',
  damage_level: '',
  electricity_condition: '',
  health_services: '',
  pressing_needs: [] as string[],
  pressing_needs_other: '',
  has_debris: '',
  description: '',
  is_urgent: false,
  submitter_contact: '',
};

export function parseCoordinate(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function hasValidCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
}

export function hasLocationInput(form: Pick<typeof emptyForm, 'lat' | 'lng' | 'address_text'>): boolean {
  return hasValidCoordinates(form.lat, form.lng) || Boolean(String(form.address_text || '').trim());
}
