import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';

export function renderWithRouter(ui: React.ReactElement, options?: { initialEntries?: string[] }) {
  return render(
    <MemoryRouter
      initialEntries={options?.initialEntries}
    >
      {ui}
    </MemoryRouter>
  );
}
