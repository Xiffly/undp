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
  infra_category?: string;
  infra_name?: string;
  infra_types: string;
  crisis_type?: string;
  damage_level: 'minimal' | 'partial' | 'destroyed';
  electricity_condition?: string;
  health_services?: string;
  pressing_needs?: string;
  has_debris?: string;
  description?: string;
  source_language?: string | null;
  source_language_confidence?: number | null;
  translation_status?: 'not_needed' | 'pending' | 'completed' | 'failed' | null;
  translation_target_lang?: string | null;
  translations?: {
    [lang: string]: {
      description?: string;
      address_text?: string;
      infra_name?: string;
    };
  };
  is_urgent: number;
  submitter_contact?: string;
  contributor_key?: string;
  contributor_badge?: string;
  channel: string;
  status: 'pending' | 'verified' | 'flagged' | 'duplicate' | 'rejected';
  photos: string;
  photo_count?: number;
  media_state?: 'none' | 'ready' | 'partial_missing' | 'invalid_legacy';
  ai_media_eligibility?: 'eligible' | 'no_photos' | 'missing_media' | 'invalid_media';
  moderation_flags?: string;
  ai_classification?: string;
  ai_classification_status?: 'pending' | 'completed' | 'failed' | null;
  ai_classification_error?: string | null;
  submitted_at: string;
  verified_by?: string;
  verified_at?: string;
  internal_notes?: string;
  community_confirms: number;
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
}
