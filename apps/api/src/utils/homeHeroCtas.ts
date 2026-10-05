export function sanitizeHomeHeroMeta(key: string, meta: Record<string, unknown>) {
  if (key !== 'home.hero') return meta;
  const rawCtas = meta.ctas;
  if (!Array.isArray(rawCtas)) return meta;
  const ctas = rawCtas.filter((cta) => cta && typeof cta === 'object' && (cta as { id?: string }).id !== 'news');
  return ctas.length === rawCtas.length ? meta : { ...meta, ctas };
}
