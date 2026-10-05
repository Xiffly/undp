// Frozen baseline: supports both new and existing installations.
export const baselineSql = `
    CREATE TABLE IF NOT EXISTS building_footprint_sets (
      id TEXT PRIMARY KEY,
      crisis_event_id TEXT NOT NULL DEFAULT 'default',
      name TEXT NOT NULL,
      description TEXT,
      geojson JSONB NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
      feature_count INTEGER NOT NULL DEFAULT 0,
      uploaded_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_building_footprint_sets_crisis ON building_footprint_sets(crisis_event_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      location_id TEXT,
      version_number INTEGER DEFAULT 1,
      actor_key TEXT,
      location_capture_mode TEXT DEFAULT 'unknown',
      footprint_set_id TEXT,
      footprint_feature_id TEXT,
      footprint_feature_key TEXT,
      building_label TEXT,
      crisis_event TEXT DEFAULT 'default',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      address_text TEXT,
      infra_category TEXT DEFAULT 'residential',
      infra_name TEXT,
      infra_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      crisis_type TEXT,
      damage_level TEXT NOT NULL,
      electricity_condition TEXT,
      health_services TEXT,
      pressing_needs JSONB NOT NULL DEFAULT '[]'::jsonb,
      has_debris TEXT DEFAULT 'unknown',
      description TEXT,
      extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_urgent BOOLEAN DEFAULT FALSE,
      submitter_contact TEXT,
      contributor_key TEXT,
      contributor_badge TEXT,
      country_code TEXT,
      channel TEXT DEFAULT 'web',
      status TEXT DEFAULT 'pending',
      photos JSONB NOT NULL DEFAULT '[]'::jsonb,
      moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      verified_by TEXT,
      verified_at TIMESTAMPTZ,
      internal_notes TEXT,
      community_confirms INTEGER DEFAULT 0,
      ai_classification JSONB,
      ai_classification_model TEXT,
      ai_classified_at TIMESTAMPTZ,
      ai_classification_status TEXT,
      ai_classification_error TEXT,
      source_language TEXT,
      source_language_confidence DOUBLE PRECISION,
      translation_status TEXT
    );

    -- Ensure new columns exist on pre-existing deployments before indexing
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_id TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS version_number INTEGER DEFAULT 1;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS actor_key TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS location_capture_mode TEXT DEFAULT 'unknown';
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS country_code TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS contributor_key TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS contributor_badge TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS footprint_set_id TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS footprint_feature_id TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS footprint_feature_key TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS building_label TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS moderation_flags JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_classification JSONB;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_classification_model TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_classification_status TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS ai_classification_error TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_language TEXT;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_language_confidence DOUBLE PRECISION;
    ALTER TABLE reports ADD COLUMN IF NOT EXISTS translation_status TEXT;
    ALTER TABLE reports ALTER COLUMN lat DROP NOT NULL;
    ALTER TABLE reports ALTER COLUMN lng DROP NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_reports_damage ON reports(damage_level);
    CREATE INDEX IF NOT EXISTS idx_reports_submitted ON reports(submitted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reports_crisis ON reports(crisis_event);
    CREATE INDEX IF NOT EXISTS idx_reports_location ON reports(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_reports_crisis_type ON reports(crisis_type);
    CREATE INDEX IF NOT EXISTS idx_reports_infra_cat ON reports(infra_category);
    CREATE INDEX IF NOT EXISTS idx_reports_location_id ON reports(location_id);
    CREATE INDEX IF NOT EXISTS idx_reports_footprint_identity ON reports(footprint_set_id, footprint_feature_id);
    CREATE INDEX IF NOT EXISTS idx_reports_contributor_key ON reports(contributor_key);
    CREATE INDEX IF NOT EXISTS idx_reports_actor_key ON reports(actor_key);
    CREATE INDEX IF NOT EXISTS idx_reports_source_language ON reports(source_language);
    CREATE INDEX IF NOT EXISTS idx_reports_translation_status ON reports(translation_status);

    CREATE TABLE IF NOT EXISTS report_locations (
      id TEXT PRIMARY KEY,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      footprint_set_id TEXT,
      footprint_feature_id TEXT,
      footprint_feature_key TEXT,
      building_label TEXT,
      address_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_report_id TEXT
    );
    ALTER TABLE report_locations ADD COLUMN IF NOT EXISTS footprint_set_id TEXT;
    ALTER TABLE report_locations ADD COLUMN IF NOT EXISTS footprint_feature_id TEXT;
    ALTER TABLE report_locations ADD COLUMN IF NOT EXISTS footprint_feature_key TEXT;
    ALTER TABLE report_locations ADD COLUMN IF NOT EXISTS building_label TEXT;
    ALTER TABLE report_locations ALTER COLUMN lat DROP NOT NULL;
    ALTER TABLE report_locations ALTER COLUMN lng DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_report_locations_latlng ON report_locations(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_report_locations_footprint_identity ON report_locations(footprint_set_id, footprint_feature_id);

    CREATE TABLE IF NOT EXISTS report_versions (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      report_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      change_type TEXT NOT NULL DEFAULT 'submit',
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      payload JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_report_versions_location ON report_versions(location_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions(report_id);

    CREATE TABLE IF NOT EXISTS ai_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS moderation_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_classify_jobs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
      last_error_code TEXT,
      last_error_message TEXT,
      last_model TEXT,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_classify_jobs_status_next_attempt ON ai_classify_jobs(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_ai_classify_jobs_locked_at ON ai_classify_jobs(locked_at);

    CREATE TABLE IF NOT EXISTS report_geocode_jobs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
      last_error_code TEXT,
      last_error_message TEXT,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_report_geocode_jobs_status_next_attempt ON report_geocode_jobs(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_report_geocode_jobs_locked_at ON report_geocode_jobs(locked_at);

    CREATE TABLE IF NOT EXISTS translation_jobs (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      target_lang TEXT NOT NULL DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
      last_error_message TEXT,
      last_provider TEXT,
      last_model TEXT,
      locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE translation_jobs DROP CONSTRAINT IF EXISTS translation_jobs_report_id_key;
    DROP INDEX IF EXISTS translation_jobs_report_id_key;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_translation_jobs_report_target_lang ON translation_jobs(report_id, target_lang);
    CREATE INDEX IF NOT EXISTS idx_translation_jobs_status_next_attempt ON translation_jobs(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_translation_jobs_locked_at ON translation_jobs(locked_at);

    CREATE TABLE IF NOT EXISTS ai_classify_attempts (
      id BIGSERIAL PRIMARY KEY,
      report_id TEXT NOT NULL,
      model TEXT NOT NULL,
      endpoint_type TEXT NOT NULL DEFAULT 'classify',
      outcome_code TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_classify_attempts_created ON ai_classify_attempts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_classify_attempts_report ON ai_classify_attempts(report_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      phone TEXT PRIMARY KEY,
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at BIGINT NOT NULL,
      actor_key TEXT,
      phone_e164 TEXT,
      verification_nonce TEXT,
      verification_user_id TEXT,
      verification_expires_at TIMESTAMPTZ
    );
    ALTER TABLE whatsapp_sessions ALTER COLUMN data TYPE JSONB USING
      CASE
        WHEN data IS NULL OR trim(data::text) = '' THEN '{}'::jsonb
        WHEN left(trim(data::text), 1) = '{' THEN data::jsonb
        ELSE jsonb_build_object('legacy', data::text)
      END;
    ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS actor_key TEXT;
    ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS phone_e164 TEXT;
    ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS verification_nonce TEXT;
    ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS verification_user_id TEXT;
    ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_wa_sessions_updated ON whatsapp_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_wa_sessions_phone_e164 ON whatsapp_sessions(phone_e164);
    CREATE INDEX IF NOT EXISTS idx_wa_sessions_verification_user ON whatsapp_sessions(verification_user_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'field_officer',
      organization TEXT,
      phone TEXT,
      address_line TEXT,
      country_code TEXT,
      profile_photo_key TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_login TIMESTAMPTZ
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS country_code TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_key TEXT;
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      request_ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires ON password_reset_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS crisis_events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT,
      region TEXT,
      crisis_type TEXT,
      status TEXT DEFAULT 'active',
      started_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS form_fields (
      id TEXT PRIMARY KEY,
      crisis_event_id TEXT NOT NULL DEFAULT 'default',
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT TRUE,
      field_order INTEGER NOT NULL DEFAULT 0,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      placeholder TEXT,
      max_length INTEGER DEFAULT 500,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_core BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_form_crisis ON form_fields(crisis_event_id);
    CREATE INDEX IF NOT EXISTS idx_form_order ON form_fields(field_order);

    CREATE TABLE IF NOT EXISTS site_content_entries (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      body TEXT,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system BOOLEAN NOT NULL DEFAULT FALSE,
      content_revision INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE site_content_entries ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_site_content_entries_sort_order ON site_content_entries(sort_order);
    CREATE INDEX IF NOT EXISTS idx_site_content_entries_enabled ON site_content_entries(is_enabled);

    CREATE TABLE IF NOT EXISTS site_content_entry_translations (
      id TEXT PRIMARY KEY,
      entry_id TEXT NOT NULL REFERENCES site_content_entries(id) ON DELETE CASCADE,
      language_code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      body_document JSONB NOT NULL DEFAULT '[]'::jsonb,
      meta_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      source_version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(entry_id, language_code)
    );
    CREATE INDEX IF NOT EXISTS idx_site_content_entry_translations_lang ON site_content_entry_translations(language_code, status);
    CREATE INDEX IF NOT EXISTS idx_site_content_entry_translations_entry ON site_content_entry_translations(entry_id);

    CREATE TABLE IF NOT EXISTS news_articles (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      excerpt TEXT,
      body TEXT,
      featured_image_key TEXT,
      featured_image_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      created_by TEXT,
      updated_by TEXT,
      content_revision INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS content_revision INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX IF NOT EXISTS idx_news_articles_status_published ON news_articles(status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_articles_slug ON news_articles(slug);

    CREATE TABLE IF NOT EXISTS news_article_translations (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES news_articles(id) ON DELETE CASCADE,
      language_code TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      excerpt TEXT,
      body_document JSONB NOT NULL DEFAULT '[]'::jsonb,
      seo_title TEXT,
      seo_description TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at TIMESTAMPTZ,
      source_version INTEGER NOT NULL DEFAULT 1,
      updated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(article_id, language_code),
      UNIQUE(language_code, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_news_article_translations_lang_status ON news_article_translations(language_code, status, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_news_article_translations_slug ON news_article_translations(language_code, slug);

    CREATE TABLE IF NOT EXISTS sitrep_logs (
      id BIGSERIAL PRIMARY KEY,
      generated_at TIMESTAMPTZ DEFAULT NOW(),
      report_count INTEGER,
      content TEXT,
      focus_area TEXT,
      model TEXT,
      stats_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      report_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      filters_json JSONB NOT NULL DEFAULT '{}'::jsonb
    );
    ALTER TABLE sitrep_logs ADD COLUMN IF NOT EXISTS stats_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE sitrep_logs ADD COLUMN IF NOT EXISTS report_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE sitrep_logs ADD COLUMN IF NOT EXISTS filters_json JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_sitrep_logs_generated_at ON sitrep_logs(generated_at DESC);

    CREATE TABLE IF NOT EXISTS report_translations (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      target_lang TEXT NOT NULL,
      source_lang TEXT,
      translated_text TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openrouter',
      model TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(report_id, field_name, target_lang)
    );
    ALTER TABLE report_translations ADD COLUMN IF NOT EXISTS source_lang TEXT;
    CREATE INDEX IF NOT EXISTS idx_report_translations_report_lang ON report_translations(report_id, target_lang);
    CREATE INDEX IF NOT EXISTS idx_report_translations_updated ON report_translations(updated_at DESC);

    CREATE TABLE IF NOT EXISTS report_confirmations (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      actor_key TEXT,
      ip_hash TEXT NOT NULL,
      country_code TEXT,
      user_agent_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(report_id, ip_hash)
    );
    ALTER TABLE report_confirmations ADD COLUMN IF NOT EXISTS actor_key TEXT;
    CREATE INDEX IF NOT EXISTS idx_report_confirmations_report ON report_confirmations(report_id);
    CREATE INDEX IF NOT EXISTS idx_report_confirmations_created ON report_confirmations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_report_confirmations_actor_key ON report_confirmations(actor_key);

    CREATE TABLE IF NOT EXISTS contributor_profiles (
      contributor_key TEXT PRIMARY KEY,
      primary_contact TEXT,
      primary_badge TEXT NOT NULL DEFAULT 'none',
      level_code TEXT NOT NULL DEFAULT 'contributor',
      reports_submitted INTEGER NOT NULL DEFAULT 0,
      reports_verified INTEGER NOT NULL DEFAULT 0,
      reports_duplicate INTEGER NOT NULL DEFAULT 0,
      reports_rejected INTEGER NOT NULL DEFAULT 0,
      reports_flagged_pending INTEGER NOT NULL DEFAULT 0,
      duplicate_reports INTEGER NOT NULL DEFAULT 0,
      flagged_reports INTEGER NOT NULL DEFAULT 0,
      suspicious_reports INTEGER NOT NULL DEFAULT 0,
      confirmations_made INTEGER NOT NULL DEFAULT 0,
      distinct_infra_types INTEGER NOT NULL DEFAULT 0,
      distinct_languages INTEGER NOT NULL DEFAULT 0,
      distinct_crises INTEGER NOT NULL DEFAULT 0,
      new_coverage_reports INTEGER NOT NULL DEFAULT 0,
      useful_detail_reports INTEGER NOT NULL DEFAULT 0,
      high_quality_verified_reports INTEGER NOT NULL DEFAULT 0,
      points_total INTEGER NOT NULL DEFAULT 0,
      validation_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
      trust_score INTEGER NOT NULL DEFAULT 0,
      badge TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      first_verified_at TIMESTAMPTZ,
      last_submitted_at TIMESTAMPTZ,
      last_engaged_at TIMESTAMPTZ
    );
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS primary_badge TEXT NOT NULL DEFAULT 'none';
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS level_code TEXT NOT NULL DEFAULT 'contributor';
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS reports_duplicate INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS reports_rejected INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS reports_flagged_pending INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS confirmations_made INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS distinct_infra_types INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS distinct_languages INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS distinct_crises INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS new_coverage_reports INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS useful_detail_reports INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS high_quality_verified_reports INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS points_total INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS validation_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS first_verified_at TIMESTAMPTZ;
    ALTER TABLE contributor_profiles ADD COLUMN IF NOT EXISTS last_engaged_at TIMESTAMPTZ;
    CREATE INDEX IF NOT EXISTS idx_contributor_profiles_updated ON contributor_profiles(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_contributor_profiles_trust ON contributor_profiles(trust_score DESC);

    CREATE TABLE IF NOT EXISTS contributor_reputation_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS consent_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contributor_badge_awards (
      id TEXT PRIMARY KEY,
      contributor_key TEXT NOT NULL,
      badge_code TEXT NOT NULL,
      awarded_at TIMESTAMPTZ DEFAULT NOW(),
      award_source TEXT NOT NULL DEFAULT 'system',
      report_id TEXT,
      awarded_by TEXT,
      reason TEXT,
      revoked_at TIMESTAMPTZ
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contributor_badge_awards_active
      ON contributor_badge_awards(contributor_key, badge_code)
      WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_contributor_badge_awards_contributor ON contributor_badge_awards(contributor_key, awarded_at DESC);

    CREATE TABLE IF NOT EXISTS contributor_score_events (
      id TEXT PRIMARY KEY,
      contributor_key TEXT NOT NULL,
      event_code TEXT NOT NULL,
      points_delta INTEGER NOT NULL DEFAULT 0,
      report_id TEXT,
      source_ref TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contributor_score_events_source_ref ON contributor_score_events(source_ref);
    CREATE INDEX IF NOT EXISTS idx_contributor_score_events_contributor ON contributor_score_events(contributor_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS report_quality_reviews (
      report_id TEXT PRIMARY KEY,
      accuracy_score INTEGER,
      photo_quality_score INTEGER,
      location_precision_score INTEGER,
      completeness_score INTEGER,
      useful_infrastructure_details BOOLEAN NOT NULL DEFAULT FALSE,
      confirms_existing_damage BOOLEAN NOT NULL DEFAULT FALSE,
      new_coverage_location BOOLEAN NOT NULL DEFAULT FALSE,
      review_notes TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      manual_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_report_quality_reviews_reviewed_at ON report_quality_reviews(reviewed_at DESC);

    CREATE TABLE IF NOT EXISTS contributor_identity_aliases (
      contributor_key TEXT NOT NULL,
      actor_key TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'web',
      first_seen_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (contributor_key, actor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_contributor_identity_aliases_actor ON contributor_identity_aliases(actor_key);

    CREATE TABLE IF NOT EXISTS user_phone_verifications (
      user_id TEXT NOT NULL,
      phone_e164 TEXT NOT NULL,
      verified_at TIMESTAMPTZ DEFAULT NOW(),
      verification_source TEXT NOT NULL DEFAULT 'whatsapp_nonce',
      verified_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id),
      UNIQUE(phone_e164)
    );
    CREATE INDEX IF NOT EXISTS idx_user_phone_verifications_user ON user_phone_verifications(user_id);

    CREATE TABLE IF NOT EXISTS user_contributor_links (
      user_id TEXT NOT NULL,
      contributor_key TEXT NOT NULL,
      link_source TEXT NOT NULL DEFAULT 'phone_verified',
      linked_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id),
      UNIQUE(contributor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_user_contributor_links_user ON user_contributor_links(user_id);

    CREATE TABLE IF NOT EXISTS identity_link_audit (
      id TEXT PRIMARY KEY,
      action_code TEXT NOT NULL,
      user_id TEXT,
      contributor_key TEXT,
      actor_key TEXT,
      phone_e164 TEXT,
      performed_by TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_identity_link_audit_created ON identity_link_audit(created_at DESC);

    CREATE TABLE IF NOT EXISTS identity_link_conflicts (
      id TEXT PRIMARY KEY,
      conflict_type TEXT NOT NULL,
      phone_e164 TEXT,
      user_id TEXT,
      contributor_key TEXT,
      details TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ,
      resolved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_identity_link_conflicts_status ON identity_link_conflicts(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS contributor_merges (
      source_contributor_key TEXT PRIMARY KEY,
      target_contributor_key TEXT NOT NULL,
      merged_at TIMESTAMPTZ DEFAULT NOW(),
      merged_by TEXT,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contributor_merges_target ON contributor_merges(target_contributor_key, merged_at DESC);

    INSERT INTO crisis_events (id, name, country, crisis_type)
    VALUES ('default', 'Active Crisis Response', 'Global', 'multi')
    ON CONFLICT (id) DO NOTHING;
`;
