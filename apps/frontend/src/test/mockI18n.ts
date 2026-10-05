export const defaultTranslations: Record<string, string> = {
  'confirmation.community_standing': 'Community standing',
  'confirmation.pending_reputation_note': 'Badges and points update after reviewer validation. Submitting more reports does not increase your standing by itself.',
  'report.contributor_status': 'Contributor standing',
  'report.contributor_status_note': 'This standing reflects reviewed contribution quality and remains anonymous.',
};

function interpolate(template: string, options?: Record<string, unknown>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = options?.[key];
    return value === undefined || value === null ? `{{${key}}}` : String(value);
  });
}

export function translate(key: string, options?: Record<string, unknown>) {
  const defaultValue = typeof options?.defaultValue === 'string' ? options.defaultValue : undefined;
  const template = defaultTranslations[key] || defaultValue || key;
  return interpolate(template, options);
}
