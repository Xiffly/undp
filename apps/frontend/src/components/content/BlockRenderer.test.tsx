import React from 'react';
import { screen } from '@testing-library/react';
import BlockRenderer from './BlockRenderer';
import { renderWithRouter } from '../../test/render';

describe('BlockRenderer CTA links', () => {
  it('normalizes internal hrefs and preserves external links', () => {
    renderWithRouter(
      <BlockRenderer
        blocks={[
          {
            type: 'cta_group',
            ctas: [
              { id: 'news', label: 'News', href: 'news', variant: 'primary' },
              { id: 'map', label: 'Map', href: '/map', variant: 'secondary' },
              { id: 'external', label: 'Docs', href: 'https://example.com/docs', variant: 'secondary' },
            ],
          },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', '/news');
    expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/map');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs');
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('target', '_blank');
  });
});
