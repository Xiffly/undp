import '../loadEnv';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { initRuntimeDb } from '../dbRuntime';
import { detectActualPublicImageMimeType, saveMediaFile } from '../media';

type ReportStatus = 'pending' | 'verified' | 'flagged' | 'duplicate' | 'rejected';
type DamageLevel = 'minimal' | 'partial' | 'destroyed';
type CrisisType = 'earthquake' | 'flood' | 'tsunami' | 'hurricane' | 'wildfire' | 'explosion' | 'chemical' | 'conflict' | 'civil_unrest';
type InfraCategory = 'residential' | 'commercial' | 'government' | 'utility' | 'transport' | 'community' | 'public' | 'other';
type ElectricityCondition = 'none' | 'minor' | 'moderate' | 'severe' | 'destroyed' | 'unknown';
type HealthServices = 'fully_functional' | 'partially_functional' | 'largely_disrupted' | 'not_functioning' | 'unknown';
type DebrisState = 'yes' | 'no' | 'unknown';
type SourceLanguage = 'ar' | 'zh' | 'en' | 'fr' | 'ru' | 'es';
type Channel = 'web' | 'whatsapp';
type CaptureMode = 'gps' | 'map' | 'manual_coordinates' | 'search';

type SeedTemplate = {
  key: string;
  source_language: SourceLanguage;
  country_code: string;
  location_id: string;
  city_label: string;
  lat: number;
  lng: number;
  address_text: string;
  infra_category: InfraCategory;
  infra_name: string;
  infra_types: string[];
  crisis_type: CrisisType;
  damage_level: DamageLevel;
  electricity_condition: ElectricityCondition;
  health_services: HealthServices;
  pressing_needs: string[];
  has_debris: DebrisState;
  descriptions: string[];
  building_label?: string;
  image_asset: DemoImageAsset;
};

type ScriptOptions = {
  count: number;
  batch: number;
  prefix: string;
  replace: boolean;
};

type SyntheticReportRow = {
  id: string;
  crisis_event: string;
  lat: number;
  lng: number;
  address_text: string;
  infra_category: InfraCategory;
  infra_name: string;
  infra_types: string[];
  crisis_type: CrisisType;
  damage_level: DamageLevel;
  electricity_condition: ElectricityCondition;
  health_services: HealthServices;
  pressing_needs: string[];
  has_debris: DebrisState;
  description: string;
  is_urgent: boolean;
  channel: Channel;
  status: ReportStatus;
  photos: string[];
  submitted_at: string;
  community_confirms: number;
  location_id: string;
  version_number: number;
  country_code: string;
  source_language: SourceLanguage;
  source_language_confidence: number;
  translation_status: null;
  actor_key: string;
  location_capture_mode: CaptureMode;
  extra_fields: Record<string, never>;
  building_label: string;
  image_asset: DemoImageAsset;
};

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
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
type DemoImageAsset = keyof typeof DEMO_IMAGE_FILES;

const DEFAULT_COUNT = 50;
const DEFAULT_BATCH = 500;
const DEFAULT_PREFIX = 'CR-SEED';

const STATUS_WEIGHTS: Array<{ status: ReportStatus; weight: number }> = [
  { status: 'pending', weight: 54 },
  { status: 'verified', weight: 22 },
  { status: 'flagged', weight: 10 },
  { status: 'duplicate', weight: 9 },
  { status: 'rejected', weight: 5 },
];

const CHANNEL_WEIGHTS: Array<{ channel: Channel; weight: number }> = [
  { channel: 'web', weight: 62 },
  { channel: 'whatsapp', weight: 38 },
];

const CAPTURE_MODE_WEIGHTS: Array<{ mode: CaptureMode; weight: number }> = [
  { mode: 'search', weight: 44 },
  { mode: 'gps', weight: 28 },
  { mode: 'map', weight: 20 },
  { mode: 'manual_coordinates', weight: 8 },
];

const NEED_VARIANTS = [
  'food_water',
  'cash',
  'healthcare',
  'shelter',
  'livelihoods',
  'wash',
  'infrastructure',
  'protection',
  'local_authority',
] as const;

const NEED_LABELS: Record<string, Record<SourceLanguage, string>> = {
  food_water: {
    ar: 'الغذاء والمياه',
    zh: '食品和饮用水',
    en: 'food and drinking water',
    fr: 'de la nourriture et de l’eau',
    ru: 'продовольствия и питьевой воды',
    es: 'alimentos y agua potable',
  },
  cash: {
    ar: 'الدعم النقدي',
    zh: '现金援助',
    en: 'cash assistance',
    fr: 'une aide en espèces',
    ru: 'денежной помощи',
    es: 'apoyo en efectivo',
  },
  healthcare: {
    ar: 'الخدمات الصحية',
    zh: '医疗服务',
    en: 'health services',
    fr: 'des services de santé',
    ru: 'медицинской помощи',
    es: 'servicios de salud',
  },
  shelter: {
    ar: 'المأوى المؤقت',
    zh: '临时住所',
    en: 'temporary shelter',
    fr: 'un hébergement temporaire',
    ru: 'временного размещения',
    es: 'alojamiento temporal',
  },
  livelihoods: {
    ar: 'سبل كسب العيش',
    zh: '生计恢复',
    en: 'livelihood recovery',
    fr: 'la reprise des moyens de subsistance',
    ru: 'восстановления источников дохода',
    es: 'la recuperación de medios de vida',
  },
  wash: {
    ar: 'المياه والإصحاح',
    zh: '供水与环境卫生',
    en: 'water and sanitation support',
    fr: 'l’eau et l’assainissement',
    ru: 'водоснабжения и санитарии',
    es: 'agua y saneamiento',
  },
  infrastructure: {
    ar: 'إصلاح البنية التحتية',
    zh: '基础设施修复',
    en: 'infrastructure repair',
    fr: 'la réparation des infrastructures',
    ru: 'восстановления инфраструктуры',
    es: 'la reparación de infraestructura',
  },
  protection: {
    ar: 'الحماية المجتمعية',
    zh: '社区保护支持',
    en: 'community protection support',
    fr: 'la protection communautaire',
    ru: 'мер по защите населения',
    es: 'protección comunitaria',
  },
  local_authority: {
    ar: 'تنسيق السلطات المحلية',
    zh: '地方政府协调',
    en: 'local authority coordination',
    fr: 'la coordination avec les autorités locales',
    ru: 'координации с местными властями',
    es: 'coordinación con autoridades locales',
  },
};

const TEMPLATES: SeedTemplate[] = [
  {
    key: 'ar-baghdad-school',
    source_language: 'ar',
    country_code: 'iq',
    location_id: 'seed-baghdad-karkh-school',
    city_label: 'Baghdad, Iraq',
    lat: 33.3054,
    lng: 44.3615,
    address_text: 'شارع حيفا، الكرخ، بغداد',
    infra_category: 'public',
    infra_name: 'مدرسة الكرخ الابتدائية للبنين',
    infra_types: ['education', 'public'],
    crisis_type: 'conflict',
    damage_level: 'partial',
    electricity_condition: 'moderate',
    health_services: 'unknown',
    pressing_needs: ['infrastructure', 'protection'],
    has_debris: 'yes',
    descriptions: [
      'أفاد السكان بوجود أضرار في الواجهة الأمامية وتحطم بعض النوافذ مع بقاء أنقاض خفيفة عند المدخل الرئيسي.',
      'أبلغ فريق الحي عن تشققات في الممر الخارجي وتعطل بابين في المبنى بعد الانفجار القريب.',
      'توجد أضرار جزئية في الصفوف الأمامية، ويحتاج الموقع إلى إزالة الأنقاض وفحص السلامة الإنشائية.',
    ],
    image_asset: 'partial_school',
  },
  {
    key: 'ar-sanaa-clinic',
    source_language: 'ar',
    country_code: 'ye',
    location_id: 'seed-sanaa-revolution-clinic',
    city_label: "Sana'a, Yemen",
    lat: 15.3525,
    lng: 44.2067,
    address_text: 'شارع الزبيري، مديرية معين، صنعاء',
    infra_category: 'community',
    infra_name: 'عيادة الثورة المجتمعية',
    infra_types: ['health', 'community'],
    crisis_type: 'flood',
    damage_level: 'partial',
    electricity_condition: 'severe',
    health_services: 'partially_functional',
    pressing_needs: ['healthcare', 'wash'],
    has_debris: 'yes',
    descriptions: [
      'دخلت مياه الفيضانات إلى الطابق الأرضي وتضررت غرفة التطعيم مع تراكم الطين في الممرات.',
      'العيادة ما زالت تستقبل الحالات الطارئة، لكن الأجهزة في غرفة الفحص تحتاج إلى تجفيف وصيانة عاجلة.',
      'أبلغ الموظفون عن تضرر الأبواب الداخلية وانقطاع الكهرباء لفترات طويلة بعد ارتفاع منسوب المياه.',
    ],
    image_asset: 'partial_homes',
  },
  {
    key: 'en-cahir-road',
    source_language: 'en',
    country_code: 'ie',
    location_id: 'seed-cahir-bridge-approach',
    city_label: 'Cahir, Ireland',
    lat: 52.3765,
    lng: -7.9217,
    address_text: 'South approach to Cahir Bridge, Bridge Street, Cahir',
    infra_category: 'transport',
    infra_name: 'Bridge Approach Road',
    infra_types: ['transport', 'road'],
    crisis_type: 'flood',
    damage_level: 'partial',
    electricity_condition: 'unknown',
    health_services: 'unknown',
    pressing_needs: ['infrastructure', 'local_authority'],
    has_debris: 'yes',
    descriptions: [
      'The road shoulder has washed out beside the bridge approach and one lane remains passable with caution.',
      'Residents reported fresh erosion along the southbound edge after overnight flooding and debris remains near the barrier.',
      'Local drivers say access is still possible, but the damaged verge needs immediate stabilisation and signage.',
    ],
    image_asset: 'partial_road',
  },
  {
    key: 'en-houston-clinic',
    source_language: 'en',
    country_code: 'us',
    location_id: 'seed-houston-lockwood-clinic',
    city_label: 'Houston, United States',
    lat: 29.7746,
    lng: -95.3142,
    address_text: '610 Lockwood Dr, Houston, TX',
    infra_category: 'community',
    infra_name: 'Kashmere Gardens Community Clinic',
    infra_types: ['health', 'community'],
    crisis_type: 'hurricane',
    damage_level: 'partial',
    electricity_condition: 'severe',
    health_services: 'partially_functional',
    pressing_needs: ['healthcare', 'infrastructure'],
    has_debris: 'yes',
    descriptions: [
      'Staff reported roof leaks over the waiting area and intermittent generator power after the storm passed.',
      'Wind damage affected exterior cladding and the rear entrance remains blocked by fallen branches and light debris.',
      'The clinic is open for urgent cases only while repairs continue on the damaged consultation rooms.',
    ],
    image_asset: 'minimal_hospital',
  },
  {
    key: 'fr-dakar-health',
    source_language: 'fr',
    country_code: 'sn',
    location_id: 'seed-dakar-blaise-health',
    city_label: 'Dakar, Senegal',
    lat: 14.6939,
    lng: -17.4467,
    address_text: 'Avenue Blaise Diagne, Dakar',
    infra_category: 'community',
    infra_name: 'Centre de santé communal Blaise Diagne',
    infra_types: ['health', 'community'],
    crisis_type: 'flood',
    damage_level: 'partial',
    electricity_condition: 'moderate',
    health_services: 'partially_functional',
    pressing_needs: ['healthcare', 'wash'],
    has_debris: 'yes',
    descriptions: [
      'Le personnel signale de l’eau stagnante dans la cour intérieure et des dommages légers dans la salle de consultation.',
      'Plusieurs portes ont gonflé après l’inondation et l’équipe demande un nettoyage rapide des accès extérieurs.',
      'Le centre reste partiellement ouvert, mais une aile du bâtiment doit être inspectée avant la reprise complète.',
    ],
    image_asset: 'minimal_hospital',
  },
  {
    key: 'fr-marrakech-school',
    source_language: 'fr',
    country_code: 'ma',
    location_id: 'seed-marrakech-medina-school',
    city_label: 'Marrakech, Morocco',
    lat: 31.6297,
    lng: -7.9864,
    address_text: 'Rue Dar El Bacha, médina de Marrakech',
    infra_category: 'public',
    infra_name: 'École Ibn Tofail',
    infra_types: ['education', 'public'],
    crisis_type: 'earthquake',
    damage_level: 'partial',
    electricity_condition: 'minor',
    health_services: 'unknown',
    pressing_needs: ['infrastructure', 'shelter'],
    has_debris: 'yes',
    descriptions: [
      'Des fissures nouvelles sont visibles au-dessus de deux salles de classe et des gravats restent près du portail.',
      'Le directeur indique que le bâtiment principal tient encore, mais les couloirs doivent être sécurisés avant la réouverture.',
      'Une partie du mur d’enceinte s’est affaissée et l’équipe locale demande une évaluation structurelle détaillée.',
    ],
    image_asset: 'partial_school',
  },
  {
    key: 'ru-kyiv-boiler',
    source_language: 'ru',
    country_code: 'ua',
    location_id: 'seed-kyiv-boiler-yard',
    city_label: 'Kyiv, Ukraine',
    lat: 50.4686,
    lng: 30.5158,
    address_text: 'Межигорская улица, Подольский район, Киев',
    infra_category: 'utility',
    infra_name: 'Районная котельная №4',
    infra_types: ['utility', 'electricity'],
    crisis_type: 'explosion',
    damage_level: 'partial',
    electricity_condition: 'moderate',
    health_services: 'unknown',
    pressing_needs: ['infrastructure', 'debris_removal'],
    has_debris: 'yes',
    descriptions: [
      'Очевидцы сообщают о повреждении труб и выбитых дверях, проход во двор частично завален обломками.',
      'На площадке видны следы взрыва, часть внешних панелей сорвана, персонал просит ускорить осмотр оборудования.',
      'Доступ к служебному входу ограничен из-за мусора и фрагментов металла, однако полный обвал не подтверждён.',
    ],
    image_asset: 'destroyed_utility',
  },
  {
    key: 'es-cdmx-community',
    source_language: 'es',
    country_code: 'mx',
    location_id: 'seed-cdmx-san-miguel',
    city_label: 'Mexico City, Mexico',
    lat: 19.4308,
    lng: -99.1356,
    address_text: 'Calle República de El Salvador, Centro, Ciudad de México',
    infra_category: 'community',
    infra_name: 'Centro comunitario San Miguel',
    infra_types: ['community', 'public'],
    crisis_type: 'earthquake',
    damage_level: 'partial',
    electricity_condition: 'moderate',
    health_services: 'unknown',
    pressing_needs: ['shelter', 'structural_assessment'],
    has_debris: 'yes',
    descriptions: [
      'Vecinos reportan grietas nuevas en las columnas del salón principal y escombros pequeños en la entrada lateral.',
      'El equipo barrial indica que el techo no colapsó, pero hay daños visibles en muros interiores y plafones.',
      'El centro sigue cerrado mientras se coordina una revisión estructural y la limpieza del acceso peatonal.',
    ],
    image_asset: 'destroyed_community',
  },
  {
    key: 'zh-shanghai-housing',
    source_language: 'zh',
    country_code: 'cn',
    location_id: 'seed-shanghai-huangpu-housing',
    city_label: 'Shanghai, China',
    lat: 31.2296,
    lng: 121.4794,
    address_text: '上海市黄浦区福州路与云南中路交叉口附近住宅楼',
    infra_category: 'residential',
    infra_name: '福州路后街住宅楼',
    infra_types: ['residential'],
    crisis_type: 'flood',
    damage_level: 'partial',
    electricity_condition: 'moderate',
    health_services: 'unknown',
    pressing_needs: ['shelter', 'wash'],
    has_debris: 'yes',
    descriptions: [
      '居民报告一层进水严重，楼道内仍有淤泥，部分墙体受潮开裂。',
      '后侧排水沟倒灌后，地下储物间被淹，住户担心电气线路受损。',
      '物业人员表示楼门口仍有积水和碎片，需要尽快清理并检查结构安全。',
    ],
    image_asset: 'partial_homes',
  },
  {
    key: 'es-quito-school',
    source_language: 'es',
    country_code: 'ec',
    location_id: 'seed-quito-floresta-school',
    city_label: 'Quito, Ecuador',
    lat: -0.2097,
    lng: -78.4862,
    address_text: 'Calle Valladolid y Coruña, La Floresta, Quito',
    infra_category: 'public',
    infra_name: 'Escuela barrial La Floresta',
    infra_types: ['education', 'public'],
    crisis_type: 'wildfire',
    damage_level: 'minimal',
    electricity_condition: 'minor',
    health_services: 'unknown',
    pressing_needs: ['protection', 'infrastructure'],
    has_debris: 'no',
    descriptions: [
      'Docentes informan olor persistente a humo y manchas de hollín en ventanas del bloque norte.',
      'No se observan daños estructurales graves, pero varias aulas necesitan limpieza profunda y revisión eléctrica.',
      'La escuela puede reabrir parcialmente, aunque el personal solicita apoyo para evaluar la ventilación interior.',
    ],
    image_asset: 'partial_school',
  },
  {
    key: 'zh-chengdu-community',
    source_language: 'zh',
    country_code: 'cn',
    location_id: 'seed-chengdu-jianshe-community',
    city_label: 'Chengdu, China',
    lat: 30.6703,
    lng: 104.1006,
    address_text: '成都市成华区建设路社区服务中心',
    infra_category: 'community',
    infra_name: '建设路社区服务中心',
    infra_types: ['community', 'public'],
    crisis_type: 'earthquake',
    damage_level: 'minimal',
    electricity_condition: 'minor',
    health_services: 'fully_functional',
    pressing_needs: ['local_authority', 'infrastructure'],
    has_debris: 'no',
    descriptions: [
      '社区工作人员发现大厅吊顶局部开裂，建筑仍可使用，但建议安排详细检查。',
      '墙角出现新的细小裂缝，门窗能够正常开启，暂未发现明显坍塌风险。',
      '居民活动室有轻微掉灰和装饰板松动，需要后续维护处理。',
    ],
    image_asset: 'minimal_utility',
  },
  {
    key: 'ru-odesa-school',
    source_language: 'ru',
    country_code: 'ua',
    location_id: 'seed-odesa-kanatna-school',
    city_label: 'Odesa, Ukraine',
    lat: 46.4741,
    lng: 30.7426,
    address_text: 'Канатная улица, Приморский район, Одесса',
    infra_category: 'public',
    infra_name: 'Средняя школа №27',
    infra_types: ['education', 'public'],
    crisis_type: 'conflict',
    damage_level: 'partial',
    electricity_condition: 'minor',
    health_services: 'unknown',
    pressing_needs: ['protection', 'infrastructure'],
    has_debris: 'yes',
    descriptions: [
      'После удара поблизости выбиты окна спортивного зала и повреждена часть наружной облицовки.',
      'Учителя сообщили о трещинах в переходе между корпусами и о стекле на школьном дворе.',
      'Здание не разрушено полностью, но требуется срочный осмотр и уборка территории перед допуском детей.',
    ],
    image_asset: 'partial_school',
  },
];

const TEMPLATE_SEQUENCE = [
  'ar-baghdad-school',
  'zh-shanghai-housing',
  'en-cahir-road',
  'fr-dakar-health',
  'ru-kyiv-boiler',
  'es-cdmx-community',
  'ar-sanaa-clinic',
  'zh-chengdu-community',
  'en-houston-clinic',
  'fr-marrakech-school',
  'ru-odesa-school',
  'es-quito-school',
] as const;

const TEMPLATES_BY_KEY = new Map(TEMPLATES.map((template) => [template.key, template]));

function parseArgs(argv: string[]): ScriptOptions {
  const options: ScriptOptions = {
    count: DEFAULT_COUNT,
    batch: DEFAULT_BATCH,
    prefix: DEFAULT_PREFIX,
    replace: true,
  };

  for (const arg of argv) {
    if (arg.startsWith('--count=')) options.count = parsePositiveInt(arg.slice('--count='.length), DEFAULT_COUNT);
    else if (arg.startsWith('--batch=')) options.batch = parsePositiveInt(arg.slice('--batch='.length), DEFAULT_BATCH);
    else if (arg.startsWith('--prefix=')) options.prefix = String(arg.slice('--prefix='.length) || DEFAULT_PREFIX).trim() || DEFAULT_PREFIX;
    else if (arg === '--append') options.replace = false;
    else if (arg === '--replace') options.replace = true;
  }

  return options;
}

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let result = Math.imul(state ^ (state >>> 15), 1 | state);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted<T extends string>(items: Array<{ [key: string]: T | number }>, random: () => number, valueKey: string): T {
  const total = items.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  let cursor = random() * total;
  for (const item of items) {
    cursor -= Number(item.weight || 0);
    if (cursor <= 0) return String(item[valueKey]) as T;
  }
  return String(items[items.length - 1][valueKey]) as T;
}

function clampCoordinate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildId(prefix: string, index: number) {
  return `${prefix}-${String(index + 1).padStart(6, '0')}`;
}

function pickTemplate(index: number, random: () => number) {
  if (index < TEMPLATE_SEQUENCE.length) {
    const template = TEMPLATES_BY_KEY.get(TEMPLATE_SEQUENCE[index]);
    if (template) return template;
  }
  return TEMPLATES[Math.floor(random() * TEMPLATES.length)];
}

function buildDescription(template: SeedTemplate, index: number, random: () => number) {
  const base = template.descriptions[index % template.descriptions.length];
  const extraNeeds = template.pressing_needs.length > 1 && random() > 0.62
    ? ` ${buildNeedsTail(template.source_language, template.pressing_needs[1])}`
    : '';
  return `${base}${extraNeeds}`.trim();
}

function buildNeedsTail(language: SourceLanguage, need: string) {
  const label = NEED_LABELS[need]?.[language] || need;
  if (language === 'ar') return `ويطلب السكان دعماً إضافياً يتعلق بـ ${label}.`;
  if (language === 'zh') return `社区还特别提出了与${label}相关的后续需求。`;
  if (language === 'fr') return `L’équipe locale mentionne aussi un besoin complémentaire lié à ${label}.`;
  if (language === 'ru') return `Жители также отдельно отмечают потребность, связанную с ${label}.`;
  if (language === 'es') return `La comunidad también señala una necesidad adicional relacionada con ${label}.`;
  return `Local responders also flagged a follow-up need related to ${label}.`;
}

function buildReport(template: SeedTemplate, index: number, prefix: string, random: () => number): SyntheticReportRow {
  const status = pickWeighted<ReportStatus>(STATUS_WEIGHTS as any, random, 'status');
  const channel = pickWeighted<Channel>(CHANNEL_WEIGHTS as any, random, 'channel');
  const location_capture_mode = pickWeighted<CaptureMode>(CAPTURE_MODE_WEIGHTS as any, random, 'mode');
  const jitterLat = (random() - 0.5) * 0.0065;
  const jitterLng = (random() - 0.5) * 0.0065;
  const submittedHoursAgo = Math.floor(random() * (24 * 45));
  const extraNeed = random() > 0.7 ? NEED_VARIANTS[Math.floor(random() * NEED_VARIANTS.length)] : null;
  const pressing_needs = Array.from(new Set([
    ...template.pressing_needs,
    ...(extraNeed ? [extraNeed] : []),
  ])).slice(0, 3);

  return {
    id: buildId(prefix, index),
    crisis_event: 'default',
    lat: clampCoordinate(template.lat + jitterLat, -90, 90),
    lng: clampCoordinate(template.lng + jitterLng, -180, 180),
    address_text: template.address_text,
    infra_category: template.infra_category,
    infra_name: template.infra_name,
    infra_types: template.infra_types,
    crisis_type: template.crisis_type,
    damage_level: template.damage_level,
    electricity_condition: template.electricity_condition,
    health_services: template.health_services,
    pressing_needs,
    has_debris: template.has_debris,
    description: buildDescription(template, index, random),
    is_urgent: status === 'flagged' || status === 'pending' ? random() > 0.58 : random() > 0.85,
    channel,
    status,
    photos: [],
    submitted_at: new Date(Date.now() - (submittedHoursAgo * 60 * 60 * 1000)).toISOString(),
    community_confirms: status === 'verified' ? Math.floor(random() * 6) : Math.floor(random() * 3),
    location_id: template.location_id,
    version_number: 1,
    country_code: template.country_code,
    source_language: template.source_language,
    source_language_confidence: 0.99,
    translation_status: null,
    actor_key: `seed_actor_${template.key}_${index + 1}`,
    location_capture_mode,
    extra_fields: {},
    building_label: template.building_label || template.infra_name,
    image_asset: template.image_asset,
  };
}

function makeMediaUpload(asset: DemoImageAsset) {
  const filePath = path.join(DEMO_IMAGE_DIR, DEMO_IMAGE_FILES[asset]);
  const buffer = fs.readFileSync(filePath);
  const mimetype = detectActualPublicImageMimeType(buffer);
  if (!mimetype) {
    throw new Error(`Unable to determine MIME type for ${DEMO_IMAGE_FILES[asset]}`);
  }
  return {
    buffer,
    mimetype,
    originalname: DEMO_IMAGE_FILES[asset],
  };
}

async function deleteExistingSeedRows(client: Client, prefix: string) {
  const like = `${prefix}-%`;
  await client.query('DELETE FROM report_translations WHERE report_id LIKE $1', [like]);
  await client.query('DELETE FROM translation_jobs WHERE report_id LIKE $1', [like]);
  await client.query('DELETE FROM reports WHERE id LIKE $1', [like]);
}

async function insertBatch(client: Client, rows: SyntheticReportRow[]) {
  if (!rows.length) return;

  const columns = [
    'id', 'crisis_event', 'lat', 'lng', 'address_text', 'infra_category', 'infra_name', 'infra_types',
    'crisis_type', 'damage_level', 'electricity_condition', 'health_services', 'pressing_needs', 'has_debris',
    'description', 'is_urgent', 'submitter_contact', 'channel', 'status', 'photos', 'submitted_at',
    'verified_by', 'verified_at', 'internal_notes', 'community_confirms', 'location_id', 'version_number',
    'country_code', 'footprint_set_id', 'footprint_feature_id', 'footprint_feature_key',
    'ai_classification', 'ai_classification_model', 'ai_classified_at', 'contributor_key', 'contributor_badge',
    'moderation_flags', 'ai_classification_status', 'ai_classification_error', 'source_language',
    'source_language_confidence', 'translation_status', 'actor_key', 'location_capture_mode', 'extra_fields', 'building_label',
  ];

  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const base = rowIndex * columns.length;
    values.push(
      row.id,
      row.crisis_event,
      row.lat,
      row.lng,
      row.address_text,
      row.infra_category,
      row.infra_name,
      JSON.stringify(row.infra_types),
      row.crisis_type,
      row.damage_level,
      row.electricity_condition,
      row.health_services,
      JSON.stringify(row.pressing_needs),
      row.has_debris,
      row.description,
      row.is_urgent,
      null,
      row.channel,
      row.status,
      JSON.stringify(row.photos),
      row.submitted_at,
      null,
      null,
      null,
      row.community_confirms,
      row.location_id,
      row.version_number,
      row.country_code,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      JSON.stringify([]),
      null,
      null,
      row.source_language,
      row.source_language_confidence,
      row.translation_status,
      row.actor_key,
      row.location_capture_mode,
      JSON.stringify(row.extra_fields),
      row.building_label,
    );
    return `(${columns.map((_, columnIndex) => `$${base + columnIndex + 1}`).join(', ')})`;
  });

  await client.query(
    `INSERT INTO reports (${columns.join(', ')}) VALUES ${tuples.join(', ')}`,
    values
  );
}

async function buildSharedPhotoKeyMap(rows: SyntheticReportRow[]) {
  const shared = new Map<DemoImageAsset, string>();
  const uniqueAssets = Array.from(new Set(rows.map((row) => row.image_asset)));
  for (const asset of uniqueAssets) {
    shared.set(asset, await saveMediaFile(makeMediaUpload(asset)));
  }
  return shared;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const databaseUrl = String(process.env.DATABASE_URL || '').trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  await initRuntimeDb();

  const client = new Client({ connectionString: databaseUrl });
  const random = mulberry32(20260620);
  const rows = Array.from({ length: options.count }, (_, index) => {
    const template = pickTemplate(index, random);
    return buildReport(template, index, options.prefix, random);
  });
  const sharedPhotoKeys = await buildSharedPhotoKeyMap(rows);
  for (const row of rows) {
    row.photos = [sharedPhotoKeys.get(row.image_asset)!];
  }

  await client.connect();
  try {
    await client.query('BEGIN');
    if (options.replace) {
      await deleteExistingSeedRows(client, options.prefix);
    }

    for (let offset = 0; offset < rows.length; offset += options.batch) {
      await insertBatch(client, rows.slice(offset, offset + options.batch));
    }

    await client.query('COMMIT');

    const summary = await client.query(
      `SELECT source_language, COUNT(*)::int AS report_count
       FROM reports
       WHERE id LIKE $1
       GROUP BY source_language
       ORDER BY source_language`,
      [`${options.prefix}-%`]
    );

    console.log(JSON.stringify({
      success: true,
      inserted: rows.length,
      prefix: options.prefix,
      batch: options.batch,
      languages: summary.rows,
      sample_ids: rows.slice(0, Math.min(6, rows.length)).map((row) => row.id),
    }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[SEED_SYNTHETIC_REPORTS_FAILED]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
