import { describe, expect, it } from 'vitest';
import { sanitizeHomeHeroMeta } from '../utils/homeHeroCtas';

describe('sanitizeHomeHeroMeta', () => {
  it('removes the stale news CTA from home.hero metadata', () => {
    const next = sanitizeHomeHeroMeta('home.hero', {
      ctas: [
        { id: 'submit', href: '/submit', label: 'Submit a Report', enabled: true, sort_order: 1 },
        { id: 'map', href: '/map', label: 'View Crisis Map', enabled: true, sort_order: 2 },
        { id: 'news', href: '/news', label: 'News', enabled: true, sort_order: 3 },
      ],
      presentation: {},
    });

    expect(next).toEqual({
      ctas: [
        { id: 'submit', href: '/submit', label: 'Submit a Report', enabled: true, sort_order: 1 },
        { id: 'map', href: '/map', label: 'View Crisis Map', enabled: true, sort_order: 2 },
      ],
      presentation: {},
    });
  });

  it('leaves non-hero sections unchanged', () => {
    const meta = {
      ctas: [
        { id: 'news', href: '/news', label: 'News', enabled: true, sort_order: 1 },
      ],
    };

    expect(sanitizeHomeHeroMeta('home.stats', meta)).toBe(meta);
  });
});
