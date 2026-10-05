export type WhatsAppInfraType = 'house' | 'road' | 'school' | 'hospital' | 'water' | 'power' | 'market' | 'other';
export type WhatsAppInfraCategory =
  | 'residential'
  | 'transport'
  | 'community'
  | 'utility'
  | 'commercial'
  | 'other';

const INFRA_CATEGORY_BY_TYPE: Record<WhatsAppInfraType, WhatsAppInfraCategory> = {
  house: 'residential',
  road: 'transport',
  school: 'community',
  hospital: 'community',
  water: 'utility',
  power: 'utility',
  market: 'commercial',
  other: 'other',
};

export function deriveInfraCategoryFromTypes(types: string[]): WhatsAppInfraCategory {
  const first = types.find((type): type is WhatsAppInfraType => type in INFRA_CATEGORY_BY_TYPE);
  return first ? INFRA_CATEGORY_BY_TYPE[first] : 'other';
}
