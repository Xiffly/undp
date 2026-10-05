import React from 'react';
import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Reports from './Reports';
import { renderWithRouter } from '../../test/render';
import type { Report } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) => {
      if (options?.count != null && options.defaultValue) {
        return options.defaultValue.replace('{{count}}', String(options.count));
      }
      return options?.defaultValue || key;
    },
    i18n: {
      resolvedLanguage: 'es',
      language: 'es',
    },
  }),
}));

vi.mock('leaflet', () => ({
  default: {
    Icon: {
      Default: {
        prototype: {},
        mergeOptions: vi.fn(),
      },
    },
  },
}));

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div data-testid="map">{children}</div>,
  Marker: ({ children }: { children?: React.ReactNode }) => <div data-testid="marker">{children}</div>,
  TileLayer: () => null,
  useMap: () => ({ setView: vi.fn(), getZoom: vi.fn(() => 14), flyTo: vi.fn() }),
  useMapEvents: () => undefined,
}));

const apiMock = vi.hoisted(() => ({
  getAdminReports: vi.fn(),
  getAdminReport: vi.fn(),
  getAiStatus: vi.fn(),
  getSitrepHistory: vi.fn(),
  updateReport: vi.fn(),
  deleteReport: vi.fn(),
  reverseGeocodeReportLocation: vi.fn(),
  generateSitrep: vi.fn(),
  classifyDamage: vi.fn(),
  getClassificationStatus: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: apiMock,
}));

function createReport(overrides: Partial<Report> = {}): Report {
  return {
    id: 'r1',
    crisis_event: 'demo',
    lat: 33.1,
    lng: 35.2,
    location_capture_mode: 'gps',
    address_text: 'Original address',
    building_label: 'Building A',
    infra_category: 'education',
    infra_name: 'Original school',
    infra_types: ['school'],
    crisis_type: 'conflict',
    damage_level: 'partial',
    has_debris: 'yes',
    description: 'Original description',
    source_language: 'en',
    translation_status: 'pending',
    translation_target_lang: 'es',
    translations: {},
    is_urgent: false,
    channel: 'web',
    status: 'pending',
    photos: [],
    submitted_at: '2026-06-20T10:00:00.000Z',
    community_confirms: 0,
    ...overrides,
  };
}

async function flushTimers(ms = 0) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('admin report translation modal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    apiMock.getAdminReports.mockResolvedValue({
      reports: [createReport()],
      total: 1,
      limit: 20,
      offset: 0,
    });
    apiMock.getAiStatus.mockResolvedValue({ features: { sitrep: false } });
    apiMock.getSitrepHistory.mockResolvedValue({ logs: [] });
    apiMock.updateReport.mockResolvedValue(createReport({ translation_status: 'completed' }));
    apiMock.deleteReport.mockResolvedValue({ success: true });
    apiMock.reverseGeocodeReportLocation.mockResolvedValue({ address_text: 'Updated address' });
    apiMock.generateSitrep.mockResolvedValue({ success: true, sitrep: '', stats: {}, model: 'test', report_count: 0 });
    apiMock.classifyDamage.mockResolvedValue({ status: 'completed' });
    apiMock.getClassificationStatus.mockResolvedValue({ status: 'completed', report_id: 'r1' });
  });

  it('does not fetch a dedicated admin report until the modal is opened', async () => {
    apiMock.getAdminReport.mockResolvedValue(createReport());

    renderWithRouter(<Reports />, { initialEntries: ['/admin/reports'] });
    await flushTimers();
    expect(apiMock.getAdminReports).toHaveBeenCalled();
    expect(apiMock.getAdminReport).not.toHaveBeenCalled();
  });

  it('polls the single-report endpoint until translation completes and rerenders translated fields', async () => {
    apiMock.getAdminReport
      .mockResolvedValueOnce(createReport({
        translation_status: 'pending',
        translations: {},
      }))
      .mockResolvedValueOnce(createReport({
        translation_status: 'completed',
        translations: {
          es: {
            address_text: 'Direccion traducida',
            infra_name: 'Escuela traducida',
            description: 'Descripcion traducida',
          },
        },
      }))
      .mockResolvedValue(createReport({
        translation_status: 'completed',
        translations: {
          es: {
            address_text: 'Direccion traducida',
            infra_name: 'Escuela traducida',
            description: 'Descripcion traducida',
          },
        },
      }));

    renderWithRouter(<Reports />, { initialEntries: ['/admin/reports?reportId=r1'] });
    await flushTimers();
    expect(apiMock.getAdminReport).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Translation Pending').length).toBeGreaterThan(0);

    await flushTimers(2000);
    await flushTimers();
    expect(apiMock.getAdminReport.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent || '').toContain('Escuela traducida');
    expect(document.body.textContent || '').toContain('Direccion traducida');
    const callsAfterCompletion = apiMock.getAdminReport.mock.calls.length;

    await flushTimers(15000);
    expect(apiMock.getAdminReport.mock.calls.length).toBeLessThanOrEqual(callsAfterCompletion + 1);
  });

  it('keeps polling quickly when partial translations appear so completed status is picked up live', async () => {
    apiMock.getAdminReport
      .mockResolvedValueOnce(createReport({
        translation_status: 'pending',
        translations: {},
      }))
      .mockResolvedValueOnce(createReport({
        translation_status: 'pending',
        translations: {
          es: {
            description: 'Descripcion parcial',
          },
        },
      }))
      .mockResolvedValueOnce(createReport({
        translation_status: 'completed',
        translations: {
          es: {
            address_text: 'Direccion traducida',
            infra_name: 'Escuela traducida',
            description: 'Descripcion final',
          },
        },
      }));

    renderWithRouter(<Reports />, { initialEntries: ['/admin/reports?reportId=r1'] });
    await flushTimers();
    expect(apiMock.getAdminReport.mock.calls.length).toBeGreaterThanOrEqual(1);

    await flushTimers(2000);
    await flushTimers();
    const callsAfterPartial = apiMock.getAdminReport.mock.calls.length;
    expect(callsAfterPartial).toBeGreaterThanOrEqual(2);

    await flushTimers(2000);
    await flushTimers();
    expect(apiMock.getAdminReport.mock.calls.length).toBeGreaterThan(callsAfterPartial);
  });
});
