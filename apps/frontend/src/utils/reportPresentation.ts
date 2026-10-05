export function formatMediaStateLabel(state?: string | null): string {
  switch (state) {
    case 'none':
      return 'None';
    case 'ready':
      return 'Ready';
    case 'partial_missing':
      return 'Partial Missing';
    case 'invalid_legacy':
      return 'Invalid Legacy';
    default:
      return state
        ? state
            .split('_')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
        : 'Ready';
  }
}

export function stripAiModelPrefix(text?: string | null): string {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.replace(/^\[AI\/[^\]]+\]\s*/i, '').trim();
}

export function formatChoiceFallback(value?: string | null): string {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function formatPressingNeedLabel(value?: string | null): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('other:')) return text.slice(6).trim();
  return formatChoiceFallback(text);
}
