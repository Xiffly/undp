import '../src/loadEnv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execute, executeBatch, initRuntimeDb, queryAll } from '../src/dbRuntime';
import { deleteMediaKeys, detectActualPublicImageMimeType, saveMediaFile } from '../src/media';
import { normalizeStoredPhotoKeys } from '../src/reportMedia';
import {
  applyResolvedAccuracyScore,
  ensureContributorAlias,
  ensureReportQualityStub,
  recomputeContributorProfile,
  syncReportPhotoQualityFromAi,
} from '../src/services/contributorReputation';

type ReportStatus = 'pending' | 'verified' | 'flagged' | 'duplicate' | 'rejected';
type DamageLevel = 'minimal' | 'partial' | 'destroyed';
type CaptureMode = 'gps' | 'map' | 'manual_coordinates' | 'search';
type AiSeedState = 'completed' | 'pending' | 'failed';
type TranslationSeedState = 'not_needed' | 'pending' | 'completed' | 'failed';

type SeedTranslation = {
  status: TranslationSeedState;
  target_lang?: string;
  translated?: Partial<Record<'description' | 'address_text' | 'infra_name', string>>;
  error_message?: string;
};

type SeedAi = {
  status: AiSeedState;
  confidence?: number;
  reasoning?: string;
  last_error_code?: string;
  last_error_message?: string;
};

type SeedReport = {
  submittedHoursAgo: number;
  latOffset: number;
  lngOffset: number;
  infra_category: string;
  infra_name: string;
  infra_types: string[];
  crisis_type: string;
  damage_level: DamageLevel;
  electricity_condition: string;
  health_services: string;
  pressing_needs: string[];
  has_debris: 'yes' | 'no' | 'unknown';
  description: string;
  address_text: string;
  location_capture_mode: CaptureMode;
  is_urgent: boolean;
  channel: 'web' | 'whatsapp';
  status: ReportStatus;
  source_language: 'en' | 'ar' | 'fr' | 'es' | 'ru' | 'zh';
  submitter_contact?: string | null;
  actor_key: string;
  contributor_key: string;
  moderation_flags?: string[];
  internal_notes?: string | null;
  community_confirms?: number;
  extra_fields?: Record<string, string | string[] | boolean | null>;
  image_asset?: keyof typeof DEMO_IMAGE_FILES;
  translation?: SeedTranslation;
  ai?: SeedAi;
};

type SeedLocation = {
  location_id: string;
  name: string;
  country_code: string;
  base_lat: number;
  base_lng: number;
  reports: SeedReport[];
};

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEMO_IMAGE_DIR = path.join(WORKSPACE_ROOT, 'uploads');
const DEMO_IMAGE_FILES = {
  destroyed_building: 'demo_destroyed_building.jpg',
  destroyed_community: 'demo_destroyed_community.jpg',
  destroyed_market: 'demo_destroyed_market.jpg',
  destroyed_utility: 'demo_destroyed_utility.jpg',
  minimal_hospital: 'demo_minimal_hospital.jpg',
  minimal_utility: 'demo_minimal_utility.jpg',
  partial_gov: 'demo_partial_gov.jpg',
  partial_homes: 'demo_partial_homes.jpg',
  partial_road: 'demo_partial_road.jpg',
  partial_school: 'demo_partial_school.jpg',
} as const;

const AI_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const TRANSLATION_MODEL = 'openai/gpt-oss-120b:free';
const REVIEWER_ID = 'demo_seed_system';

function isoHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

function sha(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function makeReportId(index: number): string {
  return `CR-2026-${String(index).padStart(4, '0')}`;
}

function makeMediaUpload(asset: keyof typeof DEMO_IMAGE_FILES) {
  const filePath = path.join(DEMO_IMAGE_DIR, DEMO_IMAGE_FILES[asset]);
  const buffer = fs.readFileSync(filePath);
  const mimetype = detectActualPublicImageMimeType(buffer);
  if (!mimetype) {
    throw new Error(`Unable to determine MIME type for demo asset ${DEMO_IMAGE_FILES[asset]}`);
  }
  return {
    buffer,
    mimetype,
    originalname: DEMO_IMAGE_FILES[asset],
  };
}

const LOCATIONS: SeedLocation[] = [
  {
    location_id: 'demo-kyiv-conflict',
    name: 'Kyiv, Ukraine',
    country_code: 'ua',
    base_lat: 50.4501,
    base_lng: 30.5234,
    reports: [
      {
        submittedHoursAgo: 6,
        latOffset: 0.0018,
        lngOffset: -0.0015,
        infra_category: 'government',
        infra_name: 'District Services Building',
        infra_types: ['government', 'administration'],
        crisis_type: 'conflict',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['infrastructure', 'local_authority'],
        has_debris: 'yes',
        description: 'Facade damage and broken windows after nearby blast. Public entrance partially blocked.',
        address_text: 'Shevchenkivskyi District civic block',
        location_capture_mode: 'map',
        is_urgent: true,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_kyiv_1',
        contributor_key: 'contrib_demo_kyiv_ops',
        community_confirms: 3,
        image_asset: 'partial_gov',
        ai: { status: 'completed', confidence: 0.88, reasoning: 'Visible facade and blast damage with blocked entry.' },
      },
      {
        submittedHoursAgo: 4,
        latOffset: 0.0016,
        lngOffset: -0.0013,
        infra_category: 'government',
        infra_name: 'District Services Building',
        infra_types: ['government'],
        crisis_type: 'conflict',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['local_authority', 'other:glass cleanup'],
        has_debris: 'yes',
        description: 'Second report from same site confirming partial facade damage and debris at entrance.',
        address_text: 'Shevchenkivskyi District civic block',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'duplicate',
        source_language: 'en',
        actor_key: 'actor_demo_kyiv_2',
        contributor_key: 'contrib_demo_kyiv_ops',
        moderation_flags: ['possible_duplicate'],
        internal_notes: 'Seeded duplicate for review workflow.',
      },
      {
        submittedHoursAgo: 22,
        latOffset: -0.0022,
        lngOffset: 0.0014,
        infra_category: 'utility',
        infra_name: 'Районная подстанция',
        infra_types: ['utility', 'electricity'],
        crisis_type: 'conflict',
        damage_level: 'destroyed',
        electricity_condition: 'destroyed',
        health_services: 'unknown',
        pressing_needs: ['infrastructure', 'cash'],
        has_debris: 'yes',
        description: 'Территория подстанции сильно повреждена, а соседние кварталы сообщают о длительном отключении электричества.',
        address_text: 'Коммунальная площадка в Подольском районе',
        location_capture_mode: 'manual_coordinates',
        is_urgent: true,
        channel: 'web',
        status: 'flagged',
        source_language: 'ru',
        actor_key: 'actor_demo_kyiv_3',
        contributor_key: 'contrib_demo_kyiv_grid',
        moderation_flags: ['high_frequency_hourly'],
        internal_notes: 'Escalated for priority validation.',
        image_asset: 'destroyed_utility',
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'Utility substation heavily damaged and local power remains down.',
            address_text: 'Podil district utility yard',
            infra_name: 'Neighborhood Substation',
          },
        },
      },
    ],
  },
  {
    location_id: 'demo-sanaa-flood',
    name: "Sana'a, Yemen",
    country_code: 'ye',
    base_lat: 15.3694,
    base_lng: 44.1910,
    reports: [
      {
        submittedHoursAgo: 18,
        latOffset: 0.0012,
        lngOffset: 0.0017,
        infra_category: 'residential',
        infra_name: 'العمارة السكنية 7',
        infra_types: ['residential'],
        crisis_type: 'flood',
        damage_level: 'partial',
        electricity_condition: 'severe',
        health_services: 'unknown',
        pressing_needs: ['shelter', 'food_water', 'wash'],
        has_debris: 'yes',
        description: 'مياه الفيضانات دخلت الطابق الأرضي وتضررت غرف الكهرباء.',
        address_text: 'حي شعوب قرب السوق المحلي',
        location_capture_mode: 'gps',
        is_urgent: true,
        channel: 'whatsapp',
        status: 'pending',
        source_language: 'ar',
        actor_key: 'actor_demo_sanaa_1',
        contributor_key: 'contrib_demo_sanaa_neighbors',
        community_confirms: 2,
        image_asset: 'partial_homes',
        translation: { status: 'pending', target_lang: 'en' },
      },
      {
        submittedHoursAgo: 36,
        latOffset: -0.0016,
        lngOffset: -0.0011,
        infra_category: 'community',
        infra_name: 'Primary School Annex',
        infra_types: ['community', 'education'],
        crisis_type: 'flood',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['infrastructure', 'shelter'],
        has_debris: 'no',
        description: 'Floodwater receded but classrooms remain damaged and unsafe for use.',
        address_text: 'Old city school compound',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_sanaa_2',
        contributor_key: 'contrib_demo_sanaa_teachers',
        image_asset: 'partial_school',
        ai: { status: 'completed', confidence: 0.82, reasoning: 'Visible classroom wall damage and standing water residue.' },
      },
      {
        submittedHoursAgo: 44,
        latOffset: -0.0018,
        lngOffset: 0.0013,
        infra_category: 'commercial',
        infra_name: 'Spice Market Row',
        infra_types: ['commercial', 'market'],
        crisis_type: 'flood',
        damage_level: 'minimal',
        electricity_condition: 'minor',
        health_services: 'unknown',
        pressing_needs: ['cash', 'livelihoods'],
        has_debris: 'no',
        description: 'Shop fronts reopened but stock losses reported. Structural damage appears limited.',
        address_text: 'Market lane south entrance',
        location_capture_mode: 'map',
        is_urgent: false,
        channel: 'web',
        status: 'rejected',
        source_language: 'en',
        actor_key: 'actor_demo_sanaa_3',
        contributor_key: 'contrib_demo_sanaa_traders',
        internal_notes: 'Rejected after moderation review for weak evidence of structural damage.',
      },
    ],
  },
  {
    location_id: 'demo-cahir-flood',
    name: 'Cahir, Ireland',
    country_code: 'ie',
    base_lat: 52.3765,
    base_lng: -7.9217,
    reports: [
      {
        submittedHoursAgo: 10,
        latOffset: 0.0009,
        lngOffset: -0.0004,
        infra_category: 'transport',
        infra_name: 'Bridge Approach Road',
        infra_types: ['transport', 'road'],
        crisis_type: 'flood',
        damage_level: 'partial',
        electricity_condition: 'unknown',
        health_services: 'unknown',
        pressing_needs: ['infrastructure', 'local_authority'],
        has_debris: 'yes',
        description: 'Road shoulder washed out near the bridge approach. One lane remains passable.',
        address_text: 'South approach to Cahir bridge',
        location_capture_mode: 'gps',
        is_urgent: true,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_cahir_1',
        contributor_key: 'contrib_demo_cahir_roads',
        image_asset: 'partial_road',
        ai: { status: 'pending' },
      },
      {
        submittedHoursAgo: 8,
        latOffset: 0.0008,
        lngOffset: -0.0005,
        infra_category: 'transport',
        infra_name: 'Bridge Approach Road',
        infra_types: ['transport'],
        crisis_type: 'flood',
        damage_level: 'partial',
        electricity_condition: 'unknown',
        health_services: 'unknown',
        pressing_needs: ['infrastructure'],
        has_debris: 'yes',
        description: 'Repeated report from same flood damage point beside the bridge approach.',
        address_text: 'South approach to Cahir bridge',
        location_capture_mode: 'map',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'duplicate',
        source_language: 'en',
        actor_key: 'actor_demo_cahir_2',
        contributor_key: 'contrib_demo_cahir_roads',
        moderation_flags: ['possible_duplicate'],
        internal_notes: 'Seeded duplicate near verified road damage report.',
      },
    ],
  },
  {
    location_id: 'demo-marrakech-earthquake',
    name: 'Marrakech, Morocco',
    country_code: 'ma',
    base_lat: 31.6295,
    base_lng: -7.9811,
    reports: [
      {
        submittedHoursAgo: 72,
        latOffset: 0.0014,
        lngOffset: 0.0011,
        infra_category: 'community',
        infra_name: 'Clinique de quartier',
        infra_types: ['community', 'health'],
        crisis_type: 'earthquake',
        damage_level: 'minimal',
        electricity_condition: 'minor',
        health_services: 'partially_functional',
        pressing_needs: ['healthcare', 'infrastructure'],
        has_debris: 'no',
        description: 'La clinique fonctionne encore mais plusieurs fissures sont visibles dans le hall principal.',
        address_text: 'Quartier Sidi Youssef Ben Ali',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'web',
        status: 'pending',
        source_language: 'fr',
        actor_key: 'actor_demo_marrakech_1',
        contributor_key: 'contrib_demo_marrakech_clinic',
        image_asset: 'minimal_hospital',
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'The clinic remains open but visible cracks run through the main hall.',
            address_text: 'Sidi Youssef Ben Ali neighborhood',
            infra_name: 'Neighbourhood Clinic',
          },
        },
      },
      {
        submittedHoursAgo: 70,
        latOffset: -0.0011,
        lngOffset: 0.0016,
        infra_category: 'residential',
        infra_name: 'Courtyard Homes Cluster',
        infra_types: ['residential'],
        crisis_type: 'earthquake',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['shelter', 'cash', 'food_water'],
        has_debris: 'yes',
        description: 'Outer walls cracked and one roof corner collapsed into the courtyard.',
        address_text: 'Medina perimeter housing lane',
        location_capture_mode: 'manual_coordinates',
        is_urgent: true,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_marrakech_2',
        contributor_key: 'contrib_demo_marrakech_housing',
        image_asset: 'partial_homes',
        ai: { status: 'completed', confidence: 0.86, reasoning: 'Roof-edge collapse and cracked walls indicate partial damage.' },
      },
      {
        submittedHoursAgo: 64,
        latOffset: -0.0013,
        lngOffset: 0.0018,
        infra_category: 'residential',
        infra_name: 'Ensemble de maisons a cour',
        infra_types: ['residential'],
        crisis_type: 'earthquake',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['shelter'],
        has_debris: 'yes',
        description: 'Message supplementaire d un resident confirmant les memes dommages dans les maisons autour de la cour.',
        address_text: 'Ruelle des habitations en bordure de la medina',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'flagged',
        source_language: 'fr',
        actor_key: 'actor_demo_marrakech_3',
        contributor_key: 'contrib_demo_marrakech_housing',
        moderation_flags: ['repeat_same_description'],
        internal_notes: 'Flagged for repetitive follow-up content from same cluster.',
        translation: { status: 'failed', target_lang: 'en', error_message: 'Translation provider timeout during demo seed.' },
      },
    ],
  },
  {
    location_id: 'demo-manila-storm',
    name: 'Manila, Philippines',
    country_code: 'ph',
    base_lat: 14.5995,
    base_lng: 120.9842,
    reports: [
      {
        submittedHoursAgo: 30,
        latOffset: 0.0013,
        lngOffset: -0.0012,
        infra_category: 'public',
        infra_name: 'Barangay Hall',
        infra_types: ['public', 'government'],
        crisis_type: 'hurricane',
        damage_level: 'partial',
        electricity_condition: 'severe',
        health_services: 'unknown',
        pressing_needs: ['local_authority', 'infrastructure'],
        has_debris: 'yes',
        description: 'Roof sheets were lifted and rain entered the meeting room during the storm.',
        address_text: 'Barangay 649 civic block',
        location_capture_mode: 'map',
        is_urgent: false,
        channel: 'web',
        status: 'pending',
        source_language: 'en',
        actor_key: 'actor_demo_manila_1',
        contributor_key: 'contrib_demo_manila_barangay',
        community_confirms: 1,
        image_asset: 'partial_gov',
      },
      {
        submittedHoursAgo: 28,
        latOffset: -0.0010,
        lngOffset: -0.0008,
        infra_category: 'community',
        infra_name: 'Riverside Clinic',
        infra_types: ['community', 'health'],
        crisis_type: 'hurricane',
        damage_level: 'minimal',
        electricity_condition: 'minor',
        health_services: 'partially_functional',
        pressing_needs: ['healthcare', 'wash'],
        has_debris: 'no',
        description: 'Clinic remains open with minor water ingress and temporary generator use.',
        address_text: 'Riverside barangay service strip',
        location_capture_mode: 'gps',
        is_urgent: false,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_manila_2',
        contributor_key: 'contrib_demo_manila_health',
        image_asset: 'minimal_hospital',
        ai: { status: 'completed', confidence: 0.73, reasoning: 'Minor water ingress and limited visible structural harm.' },
      },
      {
        submittedHoursAgo: 26,
        latOffset: -0.0016,
        lngOffset: 0.0015,
        infra_category: 'utility',
        infra_name: '东部泵站',
        infra_types: ['utility', 'water'],
        crisis_type: 'flood',
        damage_level: 'minimal',
        electricity_condition: 'minor',
        health_services: 'unknown',
        pressing_needs: ['infrastructure', 'wash'],
        has_debris: 'no',
        description: '设备间保持干燥，但通往泵站的道路仍然泥泞且不稳定。',
        address_text: '东部泵站服务道路',
        location_capture_mode: 'manual_coordinates',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'pending',
        source_language: 'zh',
        actor_key: 'actor_demo_manila_3',
        contributor_key: 'contrib_demo_manila_water',
        image_asset: 'minimal_utility',
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'Station equipment is intact but the access road is still unstable.',
            address_text: 'East pumping station service road',
            infra_name: 'Pumping Station East',
          },
        },
      },
    ],
  },
  {
    location_id: 'demo-kathmandu-earthquake',
    name: 'Kathmandu, Nepal',
    country_code: 'np',
    base_lat: 27.7172,
    base_lng: 85.3240,
    reports: [
      {
        submittedHoursAgo: 120,
        latOffset: 0.0011,
        lngOffset: -0.0009,
        infra_category: 'community',
        infra_name: 'Temple Courtyard School',
        infra_types: ['community', 'education'],
        crisis_type: 'earthquake',
        damage_level: 'destroyed',
        electricity_condition: 'destroyed',
        health_services: 'unknown',
        pressing_needs: ['shelter', 'protection', 'food_water'],
        has_debris: 'yes',
        description: 'Upper wall collapsed into the courtyard and classrooms are unusable.',
        address_text: 'Patan heritage school compound',
        location_capture_mode: 'gps',
        is_urgent: true,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_kathmandu_1',
        contributor_key: 'contrib_demo_kathmandu_school',
        image_asset: 'destroyed_building',
        ai: { status: 'completed', confidence: 0.93, reasoning: 'Clear collapse with severe structural failure.' },
      },
      {
        submittedHoursAgo: 116,
        latOffset: -0.0010,
        lngOffset: 0.0010,
        infra_category: 'community',
        infra_name: 'Temple Courtyard School',
        infra_types: ['community'],
        crisis_type: 'earthquake',
        damage_level: 'minimal',
        electricity_condition: 'minor',
        health_services: 'unknown',
        pressing_needs: ['other:engineering visit'],
        has_debris: 'no',
        description: 'Late follow-up claimed only cosmetic damage, contradicting stronger evidence.',
        address_text: 'Patan heritage school compound',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'rejected',
        source_language: 'en',
        actor_key: 'actor_demo_kathmandu_2',
        contributor_key: 'contrib_demo_kathmandu_school',
        internal_notes: 'Rejected because evidence conflicts with verified collapse reports.',
      },
    ],
  },
  {
    location_id: 'demo-nairobi-explosion',
    name: 'Nairobi, Kenya',
    country_code: 'ke',
    base_lat: -1.2921,
    base_lng: 36.8219,
    reports: [
      {
        submittedHoursAgo: 14,
        latOffset: 0.0015,
        lngOffset: -0.0010,
        infra_category: 'commercial',
        infra_name: 'Open Market Section B',
        infra_types: ['commercial', 'market'],
        crisis_type: 'explosion',
        damage_level: 'destroyed',
        electricity_condition: 'destroyed',
        health_services: 'unknown',
        pressing_needs: ['cash', 'livelihoods', 'protection'],
        has_debris: 'yes',
        description: 'Several stalls destroyed after blast and nearby market access remains cordoned.',
        address_text: 'East market loading lane',
        location_capture_mode: 'map',
        is_urgent: true,
        channel: 'web',
        status: 'pending',
        source_language: 'en',
        actor_key: 'actor_demo_nairobi_1',
        contributor_key: 'contrib_demo_nairobi_market',
        image_asset: 'destroyed_market',
        ai: { status: 'failed', last_error_code: 'network_error', last_error_message: 'Provider connection failed during image classification.' },
      },
      {
        submittedHoursAgo: 13,
        latOffset: 0.0011,
        lngOffset: -0.0013,
        infra_category: 'commercial',
        infra_name: 'Mercado abierto seccion B',
        infra_types: ['commercial'],
        crisis_type: 'explosion',
        damage_level: 'destroyed',
        electricity_condition: 'destroyed',
        health_services: 'unknown',
        pressing_needs: ['cash', 'livelihoods'],
        has_debris: 'yes',
        description: 'Reporte repetido de la misma zona de explosion en el mercado enviado por un comerciante cercano.',
        address_text: 'Carril de carga del mercado oriental',
        location_capture_mode: 'gps',
        is_urgent: true,
        channel: 'whatsapp',
        status: 'duplicate',
        source_language: 'en',
        actor_key: 'actor_demo_nairobi_2',
        contributor_key: 'contrib_demo_nairobi_market',
        moderation_flags: ['possible_duplicate'],
      },
      {
        submittedHoursAgo: 11,
        latOffset: -0.0014,
        lngOffset: 0.0014,
        infra_category: 'community',
        infra_name: 'Puesto de primeros auxilios de la terminal',
        infra_types: ['community', 'health'],
        crisis_type: 'explosion',
        damage_level: 'partial',
        electricity_condition: 'moderate',
        health_services: 'partially_functional',
        pressing_needs: ['healthcare', 'protection'],
        has_debris: 'yes',
        description: 'El puesto de primeros auxilios tiene ventanas rotas pero sigue activo para el triaje.',
        address_text: 'Puerta sur de la terminal principal',
        location_capture_mode: 'search',
        is_urgent: true,
        channel: 'web',
        status: 'flagged',
        source_language: 'es',
        actor_key: 'actor_demo_nairobi_3',
        contributor_key: 'contrib_demo_nairobi_aid',
        moderation_flags: ['high_frequency_hourly'],
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'The first aid post has broken windows but remains active for triage.',
            address_text: 'Main bus park south gate',
            infra_name: 'Bus Park First Aid Post',
          },
        },
      },
    ],
  },
  {
    location_id: 'demo-jakarta-flood',
    name: 'Jakarta, Indonesia',
    country_code: 'id',
    base_lat: -6.2088,
    base_lng: 106.8456,
    reports: [
      {
        submittedHoursAgo: 52,
        latOffset: 0.0012,
        lngOffset: 0.0012,
        infra_category: 'utility',
        infra_name: 'Water Pumping Shed',
        infra_types: ['utility', 'water'],
        crisis_type: 'flood',
        damage_level: 'minimal',
        electricity_condition: 'unknown',
        health_services: 'unknown',
        pressing_needs: ['wash', 'infrastructure'],
        has_debris: 'no',
        description: 'Floodwater reached the platform but did not disable the pumping equipment.',
        address_text: 'Canal pumping service lane',
        location_capture_mode: 'manual_coordinates',
        is_urgent: false,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_jakarta_1',
        contributor_key: 'contrib_demo_jakarta_water',
        image_asset: 'minimal_utility',
        ai: { status: 'completed', confidence: 0.69, reasoning: 'Limited visible structural impact on utility enclosure.' },
      },
      {
        submittedHoursAgo: 50,
        latOffset: 0.0010,
        lngOffset: 0.0014,
        infra_category: 'utility',
        infra_name: 'Water Pumping Shed',
        infra_types: ['utility'],
        crisis_type: 'flood',
        damage_level: 'minimal',
        electricity_condition: 'unknown',
        health_services: 'unknown',
        pressing_needs: ['wash'],
        has_debris: 'no',
        description: 'Second confirmation from same pumping lane with similar flood depth.',
        address_text: 'Canal pumping service lane',
        location_capture_mode: 'gps',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'duplicate',
        source_language: 'en',
        actor_key: 'actor_demo_jakarta_2',
        contributor_key: 'contrib_demo_jakarta_water',
        moderation_flags: ['possible_duplicate'],
      },
      {
        submittedHoursAgo: 46,
        latOffset: -0.0013,
        lngOffset: -0.0015,
        infra_category: 'residential',
        infra_name: 'Canal Edge Homes',
        infra_types: ['residential'],
        crisis_type: 'flood',
        damage_level: 'partial',
        electricity_condition: 'severe',
        health_services: 'unknown',
        pressing_needs: ['shelter', 'food_water', 'wash'],
        has_debris: 'yes',
        description: 'Ground floors remain flooded and residents have moved belongings upstairs.',
        address_text: 'North canal edge settlement',
        location_capture_mode: 'search',
        is_urgent: true,
        channel: 'web',
        status: 'pending',
        source_language: 'en',
        actor_key: 'actor_demo_jakarta_3',
        contributor_key: 'contrib_demo_jakarta_housing',
        community_confirms: 4,
      },
    ],
  },
  {
    location_id: 'demo-santiago-wildfire',
    name: 'Santiago, Chile',
    country_code: 'cl',
    base_lat: -33.4489,
    base_lng: -70.6693,
    reports: [
      {
        submittedHoursAgo: 92,
        latOffset: 0.0013,
        lngOffset: -0.0011,
        infra_category: 'residential',
        infra_name: 'Conjunto habitacional de ladera',
        infra_types: ['residential'],
        crisis_type: 'wildfire',
        damage_level: 'destroyed',
        electricity_condition: 'destroyed',
        health_services: 'unknown',
        pressing_needs: ['shelter', 'cash', 'protection'],
        has_debris: 'yes',
        description: 'Varias viviendas quedaron consumidas por el fuego y el acceso por la ladera sigue siendo inseguro por los escombros.',
        address_text: 'Franja habitacional de la ladera occidental',
        location_capture_mode: 'map',
        is_urgent: true,
        channel: 'web',
        status: 'verified',
        source_language: 'es',
        actor_key: 'actor_demo_santiago_1',
        contributor_key: 'contrib_demo_santiago_fire',
        image_asset: 'destroyed_community',
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'Several homes were burned through and debris now blocks the slope access route.',
            address_text: 'Western hillside housing strip',
            infra_name: 'Hillside Housing Block',
          },
        },
        ai: { status: 'completed', confidence: 0.91, reasoning: 'Extensive burn damage and collapse debris indicate destruction.' },
      },
      {
        submittedHoursAgo: 88,
        latOffset: -0.0010,
        lngOffset: 0.0010,
        infra_category: 'public',
        infra_name: 'Evacuation Bus Stop',
        infra_types: ['public', 'transport'],
        crisis_type: 'wildfire',
        damage_level: 'minimal',
        electricity_condition: 'unknown',
        health_services: 'unknown',
        pressing_needs: ['local_authority', 'protection'],
        has_debris: 'no',
        description: 'Stop structure remains standing but signage and shelter panels are heat damaged.',
        address_text: 'Main evacuation corridor stop',
        location_capture_mode: 'gps',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'flagged',
        source_language: 'en',
        actor_key: 'actor_demo_santiago_2',
        contributor_key: 'contrib_demo_santiago_corridor',
        moderation_flags: ['repeat_same_description'],
      },
    ],
  },
  {
    location_id: 'demo-sao-paulo-unrest',
    name: 'Sao Paulo, Brazil',
    country_code: 'br',
    base_lat: -23.5505,
    base_lng: -46.6333,
    reports: [
      {
        submittedHoursAgo: 16,
        latOffset: 0.0011,
        lngOffset: 0.0010,
        infra_category: 'government',
        infra_name: 'Quiosque de servico municipal',
        infra_types: ['government', 'public'],
        crisis_type: 'civil_unrest',
        damage_level: 'partial',
        electricity_condition: 'minor',
        health_services: 'unknown',
        pressing_needs: ['local_authority', 'protection'],
        has_debris: 'yes',
        description: 'Ventanas rotas y persianas de entrada danadas durante los disturbios de la noche.',
        address_text: 'Quiosque de la plaza del centro municipal',
        location_capture_mode: 'search',
        is_urgent: false,
        channel: 'web',
        status: 'pending',
        source_language: 'es',
        actor_key: 'actor_demo_saopaulo_1',
        contributor_key: 'contrib_demo_saopaulo_civic',
        image_asset: 'partial_gov',
        translation: {
          status: 'completed',
          target_lang: 'en',
          translated: {
            description: 'Windows were broken and the entrance shutters were damaged during overnight unrest.',
            address_text: 'Centro municipal square kiosk',
            infra_name: 'Municipal Service Kiosk',
          },
        },
      },
      {
        submittedHoursAgo: 15,
        latOffset: 0.0013,
        lngOffset: 0.0012,
        infra_category: 'government',
        infra_name: 'Municipal Service Kiosk',
        infra_types: ['government'],
        crisis_type: 'civil_unrest',
        damage_level: 'partial',
        electricity_condition: 'minor',
        health_services: 'unknown',
        pressing_needs: ['other:security barrier'],
        has_debris: 'yes',
        description: 'A follow-up message with blurry evidence was later rejected by reviewers.',
        address_text: 'Centro municipal square kiosk',
        location_capture_mode: 'map',
        is_urgent: false,
        channel: 'whatsapp',
        status: 'rejected',
        source_language: 'en',
        actor_key: 'actor_demo_saopaulo_2',
        contributor_key: 'contrib_demo_saopaulo_civic',
        image_asset: 'partial_gov',
        ai: { status: 'failed', last_error_code: 'network_error', last_error_message: 'Fetch failed while rerunning demo classification.' },
      },
      {
        submittedHoursAgo: 12,
        latOffset: -0.0012,
        lngOffset: -0.0011,
        infra_category: 'utility',
        infra_name: 'Street Lighting Junction',
        infra_types: ['utility', 'electricity'],
        crisis_type: 'civil_unrest',
        damage_level: 'minimal',
        electricity_condition: 'moderate',
        health_services: 'unknown',
        pressing_needs: ['infrastructure'],
        has_debris: 'no',
        description: 'Damaged control box caused lighting outage on one block but structure remains intact.',
        address_text: 'Avenida Sao Joao block 4',
        location_capture_mode: 'manual_coordinates',
        is_urgent: false,
        channel: 'web',
        status: 'verified',
        source_language: 'en',
        actor_key: 'actor_demo_saopaulo_3',
        contributor_key: 'contrib_demo_saopaulo_grid',
      },
    ],
  },
];

async function clearExistingReportData(): Promise<string[]> {
  const existingReports = await queryAll<{ id: string; photos: unknown; contributor_key?: string | null }>(
    'SELECT id, photos, contributor_key FROM reports'
  );
  const oldMediaKeys = Array.from(new Set(
    existingReports.flatMap((report) => normalizeStoredPhotoKeys(report.photos).stored_keys)
  ));
  const oldContributorKeys = Array.from(new Set(
    existingReports.map((report) => String(report.contributor_key || '').trim()).filter(Boolean)
  ));

  await executeBatch('BEGIN');
  try {
    await execute('DELETE FROM report_confirmations');
    await execute('DELETE FROM report_translations');
    await execute('DELETE FROM translation_jobs');
    await execute('DELETE FROM report_geocode_jobs');
    await execute('DELETE FROM ai_classify_attempts');
    await execute('DELETE FROM ai_classify_jobs');
    await execute('DELETE FROM report_versions');
    await execute('DELETE FROM report_quality_reviews');
    await execute('DELETE FROM sitrep_logs');
    await execute('DELETE FROM report_locations');
    await execute('DELETE FROM reports');

    if (oldContributorKeys.length > 0) {
      const placeholders = oldContributorKeys.map(() => '?').join(',');
      await execute(`DELETE FROM contributor_identity_aliases WHERE contributor_key IN (${placeholders})`, oldContributorKeys);
      await execute(`DELETE FROM contributor_score_events WHERE contributor_key IN (${placeholders})`, oldContributorKeys);
      await execute(`DELETE FROM contributor_badge_awards WHERE contributor_key IN (${placeholders}) AND award_source = 'system'`, oldContributorKeys);
      await execute(`DELETE FROM contributor_profiles WHERE contributor_key IN (${placeholders})`, oldContributorKeys);
    }

    await executeBatch('COMMIT');
  } catch (error) {
    await executeBatch('ROLLBACK');
    throw error;
  }

  return oldMediaKeys;
}

async function insertConfirmations(reportId: string, count: number, countryCode: string): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const actorKey = `confirm_${reportId}_${index + 1}`;
    const ipHash = sha(`${reportId}:${index + 1}:demo-confirm`);
    const userAgentHash = sha(`demo-agent:${reportId}:${index + 1}`);
    await execute(
      'INSERT INTO report_confirmations (id, report_id, actor_key, ip_hash, country_code, user_agent_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        `confirm_${reportId}_${index + 1}`,
        reportId,
        actorKey,
        ipHash,
        countryCode,
        userAgentHash,
        new Date(Date.now() - ((index + 1) * 12 * 60 * 1000)).toISOString(),
      ]
    );
  }
}

async function seedTranslation(reportId: string, sourceLang: string, source: SeedReport, translation?: SeedTranslation): Promise<void> {
  if (!translation || translation.status === 'not_needed') return;
  const targetLang = translation.target_lang || 'en';
  if (translation.status === 'completed' && translation.translated) {
    const fields: Array<['description' | 'address_text' | 'infra_name', string, string]> = [
      ['description', source.description, translation.translated.description || ''],
      ['address_text', source.address_text, translation.translated.address_text || ''],
      ['infra_name', source.infra_name, translation.translated.infra_name || ''],
    ].filter((entry) => entry[2].trim()) as Array<['description' | 'address_text' | 'infra_name', string, string]>;

    for (const [fieldName, sourceText, translatedText] of fields) {
      await execute(
        `INSERT INTO report_translations (id, report_id, field_name, target_lang, source_lang, translated_text, source_hash, provider, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          `rt_${reportId}_${fieldName}_${targetLang}`,
          reportId,
          fieldName,
          targetLang,
          sourceLang,
          translatedText,
          sha(sourceText),
          'demo_seed',
          TRANSLATION_MODEL,
        ]
      );
    }
    return;
  }

  const jobStatus = translation.status === 'failed' ? 'failed_terminal' : 'pending';
  await execute(
    `INSERT INTO translation_jobs (id, report_id, target_lang, status, attempt_count, next_attempt_at, last_error_message, last_provider, last_model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      `tj_${reportId}_${targetLang}`,
      reportId,
      targetLang,
      jobStatus,
      translation.status === 'failed' ? 1 : 0,
      new Date().toISOString(),
      translation.error_message || null,
      translation.status === 'failed' ? 'openrouter' : null,
      translation.status === 'failed' ? TRANSLATION_MODEL : null,
    ]
  );
}

async function seedAi(reportId: string, submittedAt: string, report: SeedReport, photoCount: number): Promise<void> {
  if (!report.ai) return;

  if (report.ai.status === 'completed') {
    const confidence = report.ai.confidence ?? 0.8;
    const classification = {
      damage_level: report.damage_level,
      confidence,
      reasoning: report.ai.reasoning || 'Demo seed classification completed successfully.',
      debris_visible: report.has_debris === 'yes',
      urgent: report.is_urgent,
      model: AI_MODEL,
      classified_at: submittedAt,
    };
    await execute(
      `UPDATE reports
       SET ai_classification = ?::jsonb,
           ai_classification_model = ?,
           ai_classified_at = ?,
           ai_classification_status = 'completed',
           ai_classification_error = NULL,
           internal_notes = ?
       WHERE id = ?`,
      [
        JSON.stringify(classification),
        AI_MODEL,
        submittedAt,
        `Suggested: ${classification.damage_level} (${Math.round(classification.confidence * 100)}% confident). ${classification.reasoning}`,
        reportId,
      ]
    );
    await execute(
      `INSERT INTO ai_classify_jobs (id, report_id, status, attempt_count, next_attempt_at, last_model, created_at, updated_at)
       VALUES (?, ?, 'completed', 1, ?, ?, ?, NOW())`,
      [`job_${reportId}`, reportId, submittedAt, AI_MODEL, submittedAt]
    );
    await syncReportPhotoQualityFromAi(reportId, confidence, photoCount);
    return;
  }

  if (report.ai.status === 'pending') {
    await execute(
      `UPDATE reports
       SET ai_classification_status = 'pending',
           ai_classification_error = NULL
       WHERE id = ?`,
      [reportId]
    );
    await execute(
      `INSERT INTO ai_classify_jobs (id, report_id, status, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?, NOW())`,
      [`job_${reportId}`, reportId, submittedAt, submittedAt]
    );
    return;
  }

  await execute(
    `UPDATE reports
     SET ai_classification_status = 'failed',
         ai_classification_error = ?
     WHERE id = ?`,
    [report.ai.last_error_message || 'Demo seed AI failure', reportId]
  );
  await execute(
    `INSERT INTO ai_classify_jobs (id, report_id, status, attempt_count, next_attempt_at, last_error_code, last_error_message, created_at, updated_at)
     VALUES (?, ?, 'failed_terminal', 1, NULL, ?, ?, ?, NOW())`,
    [
      `job_${reportId}`,
      reportId,
      report.ai.last_error_code || 'network_error',
      report.ai.last_error_message || 'Demo seed AI failure',
      submittedAt,
    ]
  );
}

async function seedReport(location: SeedLocation, report: SeedReport, reportId: string, versionNumber: number): Promise<string[]> {
  const submittedAt = isoHoursAgo(report.submittedHoursAgo);
  const lat = Number((location.base_lat + report.latOffset).toFixed(6));
  const lng = Number((location.base_lng + report.lngOffset).toFixed(6));
  const photoKeys: string[] = [];

  if (report.image_asset) {
    const key = await saveMediaFile(makeMediaUpload(report.image_asset));
    photoKeys.push(key);
  }

  await execute(
    `INSERT INTO reports (
      id, location_id, version_number, actor_key, location_capture_mode, building_label, crisis_event,
      lat, lng, address_text, infra_category, infra_name, infra_types, crisis_type, damage_level,
      electricity_condition, health_services, pressing_needs, has_debris, description, extra_fields,
      is_urgent, submitter_contact, contributor_key, contributor_badge, country_code, channel, status,
      photos, moderation_flags, submitted_at, verified_by, verified_at, internal_notes,
      community_confirms, ai_classification_status, ai_classification_error, source_language, source_language_confidence, translation_status
    ) VALUES (?,?,?,?,? ,?,?, ?,?,?, ?,?,?, ?,?, ?,?,?, ?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?)`,
    [
      reportId,
      location.location_id,
      versionNumber,
      report.actor_key,
      report.location_capture_mode,
      report.infra_name,
      'default',
      lat,
      lng,
      report.address_text,
      report.infra_category,
      report.infra_name,
      JSON.stringify(report.infra_types),
      report.crisis_type,
      report.damage_level,
      report.electricity_condition,
      report.health_services,
      JSON.stringify(report.pressing_needs),
      report.has_debris,
      report.description,
      JSON.stringify(report.extra_fields || {}),
      report.is_urgent ? 1 : 0,
      report.submitter_contact || null,
      report.contributor_key,
      'none',
      location.country_code,
      report.channel,
      report.status,
      JSON.stringify(photoKeys),
      JSON.stringify(report.moderation_flags || []),
      submittedAt,
      ['verified', 'duplicate', 'rejected'].includes(report.status) ? REVIEWER_ID : null,
      ['verified', 'duplicate', 'rejected'].includes(report.status) ? submittedAt : null,
      report.internal_notes || null,
      report.community_confirms || 0,
      report.ai ? (report.ai.status === 'completed' ? 'completed' : report.ai.status === 'pending' ? 'pending' : 'failed') : null,
      report.ai?.status === 'failed' ? (report.ai.last_error_message || 'Demo seed AI failure') : null,
      report.source_language,
      0.99,
      report.translation?.status || (report.source_language === 'en' ? 'not_needed' : 'pending'),
    ]
  );

  await execute(
    `INSERT INTO report_versions (id, location_id, report_id, version_number, change_type, submitted_at, payload)
     VALUES (?, ?, ?, ?, 'submit', ?, ?::jsonb)`,
    [
      `rv_${reportId}`,
      location.location_id,
      reportId,
      versionNumber,
      submittedAt,
      JSON.stringify({
        actor_key: report.actor_key,
        location_capture_mode: report.location_capture_mode,
        lat,
        lng,
        address_text: report.address_text,
        building_label: report.infra_name,
        damage_level: report.damage_level,
        infra_category: report.infra_category,
        crisis_type: report.crisis_type,
      }),
    ]
  );

  await ensureContributorAlias(report.contributor_key, report.actor_key, report.channel);
  await ensureReportQualityStub(reportId, {
    addressText: report.address_text,
    infraName: report.infra_name,
    description: report.description,
    pressingNeeds: report.pressing_needs,
    photosCount: photoKeys.length,
    infraTypes: report.infra_types,
    locationCaptureMode: report.location_capture_mode,
    lat,
    lng,
    newCoverageLocation: versionNumber === 1,
  });

  if (['verified', 'duplicate', 'rejected'].includes(report.status)) {
    await applyResolvedAccuracyScore(reportId, report.status, REVIEWER_ID);
  }

  if ((report.community_confirms || 0) > 0) {
    await insertConfirmations(reportId, report.community_confirms || 0, location.country_code);
  }

  await seedTranslation(reportId, report.source_language, report, report.translation);
  await seedAi(reportId, submittedAt, report, photoKeys.length);

  return photoKeys;
}

async function upsertLocationSummary(location: SeedLocation, lastReportId: string): Promise<void> {
  await execute(
    `INSERT INTO report_locations (id, lat, lng, building_label, address_text, last_report_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      location.location_id,
      location.base_lat,
      location.base_lng,
      location.name,
      location.name,
      lastReportId,
    ]
  );
}

async function reseedReports(): Promise<void> {
  await initRuntimeDb();
  const removedMediaKeys = await clearExistingReportData();
  const seededMediaKeys: string[] = [];
  const contributorKeys = new Set<string>();
  let reportCounter = 1001;

  try {
    await executeBatch('BEGIN');
    for (const location of LOCATIONS) {
      let versionNumber = 1;
      let lastReportId = '';
      for (const report of location.reports) {
        const reportId = makeReportId(reportCounter);
        reportCounter += 1;
        const mediaKeys = await seedReport(location, report, reportId, versionNumber);
        mediaKeys.forEach((key) => seededMediaKeys.push(key));
        contributorKeys.add(report.contributor_key);
        versionNumber += 1;
        lastReportId = reportId;
      }
      await upsertLocationSummary(location, lastReportId);
    }

    await executeBatch('COMMIT');
  } catch (error) {
    await executeBatch('ROLLBACK');
    if (seededMediaKeys.length > 0) {
      await deleteMediaKeys(seededMediaKeys).catch(() => {});
    }
    throw error;
  }

  for (const contributorKey of contributorKeys) {
    const profile = await recomputeContributorProfile(contributorKey);
    if (!profile) continue;
    await execute('UPDATE reports SET contributor_badge = ? WHERE contributor_key = ?', [profile.primary_badge || 'none', contributorKey]);
  }

  if (removedMediaKeys.length > 0) {
    await deleteMediaKeys(removedMediaKeys).catch((error) => {
      console.warn('[demo-seed] failed to remove some old report media:', error instanceof Error ? error.message : String(error));
    });
  }

  const totals = await queryAll<{ status: ReportStatus; c: string | number }>(
    'SELECT status, COUNT(*)::int AS c FROM reports GROUP BY status ORDER BY status'
  );
  const mediaTotals = await queryAll<{ c: string | number }>(
    "SELECT COUNT(*)::int AS c FROM reports WHERE jsonb_array_length(photos) > 0"
  );

  const totalReports = LOCATIONS.reduce((sum, location) => sum + location.reports.length, 0);
  const imageReports = Number(mediaTotals[0]?.c || 0);
  console.log(JSON.stringify({
    success: true,
    total_locations: LOCATIONS.length,
    total_reports: totalReports,
    reports_with_images: imageReports,
    image_ratio: totalReports > 0 ? Number((imageReports / totalReports).toFixed(2)) : 0,
    statuses: Object.fromEntries(totals.map((row) => [row.status, Number(row.c || 0)])),
  }, null, 2));
}

reseedReports().catch((error) => {
  console.error('[demo-seed] reset/seed failed:', error);
  process.exitCode = 1;
});
