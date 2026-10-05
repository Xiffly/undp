import { Report } from '../../types';

export const CRISIS_TYPE_LABELS: Record<string, string> = {
  earthquake: 'Earthquake',
  flood: 'Flood',
  tsunami: 'Tsunami',
  hurricane: 'Hurricane',
  wildfire: 'Wildfire',
  explosion: 'Explosion',
  chemical: 'Chemical',
  conflict: 'Conflict',
  civil_unrest: 'Civil Unrest',
};

export const ELEC_LABELS: Record<string, string> = {
  none: 'No damage',
  minor: 'Minor',
  moderate: 'Moderate',
  severe: 'Severe',
  destroyed: 'Destroyed',
  unknown: 'Unknown',
};

export const HEALTH_LABELS: Record<string, string> = {
  fully_functional: 'Fully functional',
  partially_functional: 'Partially functional',
  largely_disrupted: 'Largely disrupted',
  not_functioning: 'Not functioning',
  unknown: 'Unknown',
};

export const CRISIS_TYPE_KEYS: Record<string, string> = {
  earthquake: 'crisis_types.earthquake',
  flood: 'crisis_types.flood',
  tsunami: 'crisis_types.tsunami',
  hurricane: 'crisis_types.hurricane',
  wildfire: 'crisis_types.wildfire',
  explosion: 'crisis_types.explosion',
  chemical: 'crisis_types.chemical',
  conflict: 'crisis_types.conflict',
  civil_unrest: 'crisis_types.civil_unrest',
};

export function scheduleTask(task: () => void) {
  return window.setTimeout(task, 0);
}

export function getAiStatusLabel(report: Report, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!report.ai_classification_status) return '';
  if (report.ai_classification_status === 'completed') return t('report.ai_ready', { defaultValue: 'Completed' });
  if (report.ai_classification_status === 'failed') return t('admin.reports.ai_failed', { defaultValue: 'AI Failed' });
  return t('report.ai_pending', { defaultValue: 'Pending AI' });
}
