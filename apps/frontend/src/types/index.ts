import type * as GeoJSON from 'geojson';

export interface Report {
  id: string;
  crisis_event: string;
  actor_key?: string | null;
  lat: number | null;
  lng: number | null;
  location_capture_mode?: string | null;
  address_text?: string;
  building_label?: string;
  footprint_set_id?: string;
  footprint_feature_id?: string;
  footprint_feature_key?: string;
  infra_category: string;
  infra_name?: string;
  infra_types: string[];
  crisis_type?: string;
  damage_level: 'minimal' | 'partial' | 'destroyed';
  electricity_condition?: string;
  health_services?: string;
  pressing_needs?: string[];
  has_debris?: 'yes' | 'no' | 'unknown' | string;
  description?: string;
  extra_fields?: Record<string, string | string[] | boolean | null>;
  source_language?: string | null;
  source_language_confidence?: number | null;
  translation_status?: 'not_needed' | 'pending' | 'completed' | 'failed' | null;
  translation_target_lang?: string | null;
  localized?: {
    description?: string;
    address_text?: string;
    infra_name?: string;
  };
  translations?: {
    [lang: string]: {
      description?: string;
      address_text?: string;
      infra_name?: string;
    };
  };
  is_urgent: boolean;
  submitter_contact?: string;
  contributor?: {
    key: string;
    badge: string;
    primary_badge: string;
    level_code: string;
    trust_score: number;
    points_total: number;
    validation_rate: number;
    badges: string[];
    reports_submitted: number;
    reports_verified: number;
    suspicious_reports: number;
  };
  channel: string;
  status: 'pending' | 'verified' | 'flagged' | 'duplicate' | 'rejected';
  photos: string[];
  photo_count?: number;
  media_state?: 'none' | 'ready' | 'partial_missing' | 'invalid_legacy';
  ai_media_eligibility?: 'eligible' | 'no_photos' | 'missing_media' | 'invalid_media';
  moderation_flags?: string[];
  ai_classification?: {
    damage_level: 'minimal' | 'partial' | 'destroyed' | 'unknown';
    confidence: number;
    reasoning: string;
    debris_visible: boolean;
    urgent: boolean;
    model: string;
    classified_at: string;
  } | null;
  ai_classification_status?: 'pending' | 'completed' | 'failed' | null;
  ai_classification_error?: string | null;
  submitted_at: string;
  verified_by?: string;
  verified_at?: string;
  internal_notes?: string;
  community_confirms: number;
}

export interface FootprintFeatureProperties {
  footprint_set_id?: string;
  footprint_set_name?: string;
  footprint_set_description?: string | null;
  feature_id?: string;
  feature_key?: string;
  name?: string;
  display_name?: string;
  address?: string;
  [key: string]: unknown;
}

export type FootprintFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  FootprintFeatureProperties
>;

export interface FootprintFeatureCollection extends GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  FootprintFeatureProperties
> {
  features: FootprintFeature[];
}

export interface FootprintSetSummary {
  id: string;
  crisis_event_id: string;
  name: string;
  description?: string | null;
  feature_count: number;
  uploaded_by?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface Stats {
  total: number;
  pending: number;
  verified: number;
  flagged?: number;
  duplicate?: number;
  rejected?: number;
  destroyed: number;
  partial: number;
  minimal: number;
  last_24h: number;
  last_hour: number;
  by_type: Record<string, number>;
  trend: { hour: string; count: number }[];
  by_channel: { channel: string; count: number }[];
  contributor_badges?: { badge: string; count: number }[];
}

export interface ContributorProfile {
  contributor_key: string;
  primary_contact?: string | null;
  primary_badge: string;
  level_code: string;
  trust_score: number;
  points_total: number;
  validation_rate: number;
  reports_submitted: number;
  reports_verified: number;
  reports_duplicate: number;
  reports_rejected: number;
  reports_flagged_pending: number;
  suspicious_reports: number;
  confirmations_made: number;
  distinct_infra_types: number;
  distinct_languages: number;
  distinct_crises: number;
  new_coverage_reports: number;
  useful_detail_reports: number;
  high_quality_verified_reports: number;
  first_verified_at?: string | null;
  last_submitted_at?: string | null;
  last_engaged_at?: string | null;
  updated_at?: string | null;
}

export interface PublicUserProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: string | null;
  phone?: string | null;
  address_line?: string | null;
  country_code?: string | null;
  profile_photo_url?: string | null;
  created_at?: string;
  last_login?: string;
}

export interface HomeCta {
  id: string;
  label: string;
  href: string;
  variant?: string;
  enabled: boolean;
  sort_order: number;
}

export type ContentTranslationStatus = 'draft' | 'review' | 'published' | 'missing';

export type LegacyRichTextNode = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  href?: string;
};

export type RichTextLeaf = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  color?: string;
  font_family_token?: ContentFontFamilyToken;
  font_size_token?: ContentFontSizeToken;
  href?: string;
};

export type RichTextElement = {
  type: 'paragraph';
  children: RichTextLeaf[];
};

export type RichTextDocument = RichTextElement[];
export type RichTextValue = RichTextDocument | LegacyRichTextNode[] | string;

export type ContentFontFamilyToken =
  | 'sans'
  | 'serif'
  | 'display'
  | 'mono'
  | 'inter'
  | 'source-serif'
  | 'ibm-plex-sans'
  | 'ibm-plex-mono'
  | 'merriweather'
  | 'lora';
export type ContentFontSizeToken =
  | 'xs'
  | 'sm'
  | 'base'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '12'
  | '14'
  | '16'
  | '18'
  | '24'
  | '32';
export type ContentFontWeight = 'regular' | 'medium' | 'semibold' | 'bold';
export type ContentTextAlign = 'left' | 'center' | 'right';
export type ContentSpacingToken = 'compact' | 'normal' | 'relaxed';

export interface ContentStyle {
  font_family_token?: ContentFontFamilyToken;
  font_size_token?: ContentFontSizeToken;
  font_weight?: ContentFontWeight;
  italic?: boolean;
  text_align?: ContentTextAlign;
  text_color_token?: string;
  spacing_token?: ContentSpacingToken;
}

export interface SectionPresentation {
  section_label?: string;
  eyebrow?: string;
  subheading?: string;
  container_width_token?: 'narrow' | 'default' | 'wide';
  background_variant_token?: 'default' | 'hero' | 'subtle' | 'accent';
  padding_token?: 'compact' | 'normal' | 'spacious';
}

export type BlockNode =
  | { type: 'paragraph'; text?: string; content?: RichTextValue; style?: ContentStyle }
  | { type: 'heading'; text?: string; content?: RichTextValue; level?: number; style?: ContentStyle }
  | { type: 'bulleted_list'; items: RichTextValue[]; style?: ContentStyle }
  | { type: 'numbered_list'; items: RichTextValue[]; style?: ContentStyle }
  | { type: 'quote'; text?: string; content?: RichTextValue; style?: ContentStyle }
  | { type: 'callout'; text?: string; content?: RichTextValue; tone?: 'info' | 'warning' | 'success'; style?: ContentStyle }
  | { type: 'image'; url: string; alt?: string; caption?: string; style?: ContentStyle }
  | { type: 'cta_group'; ctas: Array<{ id?: string; label: string; href: string; variant?: string }>; style?: ContentStyle };

export interface ContentTranslationValue {
  language_code: string;
  title?: string;
  description?: string;
  body_document?: BlockNode[];
  meta_json?: Record<string, unknown>;
  slug?: string;
  excerpt?: string;
  seo_title?: string | null;
  seo_description?: string | null;
  status: ContentTranslationStatus;
  published_at?: string | null;
  source_version: number;
}

export interface SiteContentEntry {
  id: string;
  key: string;
  title: string;
  description: string;
  body_document: BlockNode[];
  meta_json: Record<string, unknown> & { presentation?: SectionPresentation };
  is_enabled: boolean;
  sort_order: number;
  is_system: boolean;
  content_revision: number;
  requested_lang: string;
  resolved_lang: string;
  fallback: boolean;
  translation_status: ContentTranslationStatus;
  is_stale: boolean;
  source: ContentTranslationValue | null;
  translation: ContentTranslationValue | null;
  created_at?: string;
  updated_at?: string;
}

export interface HomeContentResponse {
  requested_lang: string;
  sections: SiteContentEntry[];
  live_sections?: SiteContentEntry[];
  publish_result?: {
    success: boolean;
    published_keys: string[];
    validation_errors: Record<string, string[]>;
    published_at: string;
  } | null;
}

export interface NewsArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_document: BlockNode[];
  featured_image_key?: string | null;
  featured_image_url?: string | null;
  content_revision: number;
  requested_lang: string;
  resolved_lang: string;
  fallback: boolean;
  translation_status: ContentTranslationStatus;
  is_stale: boolean;
  seo_title?: string | null;
  seo_description?: string | null;
  published_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  source: ContentTranslationValue | null;
  translation: ContentTranslationValue | null;
  translations_summary: Record<string, { status: ContentTranslationStatus; published_at?: string | null; slug?: string | null }>;
  created_at?: string;
  updated_at?: string;
}

export interface SubmitFormData {
  lat?: number;
  lng?: number;
  address_text?: string;
  building_label?: string;
  location_capture_mode?: string;
  footprint_set_id?: string;
  footprint_feature_id?: string;
  footprint_feature_key?: string;
  infra_category: string;
  infra_name: string;
  infra_types: string[];
  crisis_type: string;
  damage_level: 'minimal' | 'partial' | 'destroyed' | '';
  electricity_condition: string;
  health_services: string;
  pressing_needs: string[];
  pressing_needs_other: string;
  has_debris: string;
  description: string;
  extra_fields?: Record<string, string | string[] | boolean | null>;
  is_urgent: boolean;
  submitter_contact: string;
  photos: File[];
}

export const INFRA_CATEGORIES = [
  { id: 'residential', label: 'Residential', sublabel: 'Houses, apartments', emoji: '🏠' },
  { id: 'commercial', label: 'Commercial', sublabel: 'Markets, shops, hotels, banks', emoji: '🏪' },
  { id: 'government', label: 'Government Building', sublabel: 'Admin, courts, police, fire stations', emoji: '🏛️' },
  { id: 'utility', label: 'Utility Infrastructure', sublabel: 'Water pumps, power plants, waste treatment', emoji: '⚙️' },
  { id: 'transport', label: 'Transport & Communication', sublabel: 'Roads, bridges, cell towers, railways', emoji: '🛣️' },
  { id: 'community', label: 'Community Infrastructure', sublabel: 'Schools, hospitals, community halls', emoji: '🏫' },
  { id: 'public', label: 'Public / Recreation', sublabel: 'Stadiums, playgrounds, religious buildings', emoji: '⛪' },
  { id: 'other', label: 'Other', sublabel: 'Specify below', emoji: '📦' },
] as const;

export const CRISIS_TYPES = [
  { group: 'Natural Hazards', options: [
    { id: 'earthquake', label: 'Earthquake', emoji: '🌍' },
    { id: 'flood', label: 'Flood', emoji: '🌊' },
    { id: 'tsunami', label: 'Tsunami', emoji: '🌊' },
    { id: 'hurricane', label: 'Hurricane / Cyclone', emoji: '🌀' },
    { id: 'wildfire', label: 'Wildfire', emoji: '🔥' },
  ]},
  { group: 'Technological / Industrial', options: [
    { id: 'explosion', label: 'Explosion', emoji: '💥' },
    { id: 'chemical', label: 'Chemical Incident', emoji: '☢️' },
  ]},
  { group: 'Human-made', options: [
    { id: 'conflict', label: 'Conflict', emoji: '⚔️' },
    { id: 'civil_unrest', label: 'Civil Unrest', emoji: '🏳️' },
  ]},
] as const;

export const ELECTRICITY_CONDITIONS = [
  { id: 'none', label: 'No damage observed' },
  { id: 'minor', label: 'Minor damage (service disruptions, quickly repairable)' },
  { id: 'moderate', label: 'Moderate damage (partial outages, repairs needed)' },
  { id: 'severe', label: 'Severe damage (major infrastructure damaged, prolonged outages)' },
  { id: 'destroyed', label: 'Completely destroyed (no electricity functioning)' },
  { id: 'unknown', label: 'Unknown / cannot be assessed' },
] as const;

export const HEALTH_SERVICES = [
  { id: 'fully_functional', label: 'Fully functional' },
  { id: 'partially_functional', label: 'Partially functional' },
  { id: 'largely_disrupted', label: 'Largely disrupted' },
  { id: 'not_functioning', label: 'Not functioning at all' },
  { id: 'unknown', label: 'Unknown' },
] as const;

export const PRESSING_NEEDS = [
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
] as const;

export const DAMAGE_LEVELS = [
  {
    id: 'minimal' as const,
    label: 'Minimal / No Damage',
    sublabel: 'Structurally sound and functional, cosmetic or no visible damage',
    color: 'bg-green-50 border-green-400',
    textColor: 'text-green-700',
    emoji: '🟢',
  },
  {
    id: 'partial' as const,
    label: 'Partially Damaged',
    sublabel: 'Repairable, remains usable with caution',
    color: 'bg-orange-50 border-orange-400',
    textColor: 'text-orange-700',
    emoji: '🟡',
  },
  {
    id: 'destroyed' as const,
    label: 'Completely Damaged / Destroyed',
    sublabel: 'Structurally unsafe or destroyed, not usable',
    color: 'bg-red-50 border-red-400',
    textColor: 'text-red-700',
    emoji: '🔴',
  },
] as const;

export const INFRA_TYPES = INFRA_CATEGORIES.map(c => ({ id: c.id, label: c.label, emoji: c.emoji }));
