import React from 'react';
import { screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { vi } from 'vitest';
import HomePagePreview from './HomePagePreview';
import { buildHomeContentMap, getDefaultHomeContentMap } from './homePreviewData';
import { renderWithRouter } from '../../test/render';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue || key) as TFunction;

describe('HomePagePreview hero CTAs', () => {
  it('renders clickable hero links and excludes the news CTA', () => {
    renderWithRouter(<HomePagePreview contentMap={getDefaultHomeContentMap(t)} />);

    expect(screen.getByRole('link', { name: 'Submit a Report' })).toHaveAttribute('href', '/submit');
    expect(screen.getByRole('link', { name: 'View Crisis Map' })).toHaveAttribute('href', '/map');
    expect(screen.queryByRole('link', { name: 'News' })).not.toBeInTheDocument();
  });

  it('filters a stale news CTA from API-provided hero content', () => {
    const contentMap = buildHomeContentMap([
      {
        ...getDefaultHomeContentMap(t)['home.hero'],
        meta_json: {
          ctas: [
            { id: 'submit', label: 'Submit a Report', href: '/submit', variant: 'primary', enabled: true, sort_order: 1 },
            { id: 'map', label: 'View Crisis Map', href: '/map', variant: 'secondary', enabled: true, sort_order: 2 },
            { id: 'news', label: 'News', href: '/news', variant: 'secondary', enabled: true, sort_order: 3 },
          ],
        },
      },
    ], t);

    renderWithRouter(<HomePagePreview contentMap={contentMap} />);

    expect(screen.getByRole('link', { name: 'Submit a Report' })).toHaveAttribute('href', '/submit');
    expect(screen.getByRole('link', { name: 'View Crisis Map' })).toHaveAttribute('href', '/map');
    expect(screen.queryByRole('link', { name: 'News' })).not.toBeInTheDocument();
  });
});
