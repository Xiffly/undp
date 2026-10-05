import { describe, expect, it } from 'vitest';
import { applySitrepScopeAndDedup } from './routes/ai';

describe('applySitrepScopeAndDedup', () => {
  it('keeps only reports inside the resolved city bbox and suppresses near-duplicates', () => {
    const candidateReports = [
      {
        id: 'DN-2',
        lat: 48.4900,
        lng: 35.0700,
        submitted_at: '2026-06-13T20:20:00.000Z',
        location_id: 'dnipro-b',
        country_code: 'UA',
        status: 'pending',
      },
      {
        id: 'DN-1',
        lat: 48.4647,
        lng: 35.0462,
        submitted_at: '2026-06-13T20:00:00.000Z',
        location_id: 'dnipro-a',
        country_code: 'UA',
        status: 'verified',
      },
      {
        id: 'DN-1-DUP',
        lat: 48.4648,
        lng: 35.0463,
        submitted_at: '2026-06-13T19:30:00.000Z',
        location_id: 'dnipro-a',
        country_code: 'UA',
        status: 'pending',
      },
      {
        id: 'YE-1',
        lat: 15.3694,
        lng: 44.1910,
        submitted_at: '2026-06-13T20:10:00.000Z',
        location_id: 'sanaa-a',
        country_code: 'YE',
        status: 'verified',
      },
    ];

    const result = applySitrepScopeAndDedup({
      candidateReports,
      resolvedScope: {
        provider: 'nominatim',
        query: 'Dnipro City, Dnipropetrovsk Oblast, Ukraine',
        resolved_name: 'Dnipro City, Dnipropetrovsk Oblast, Ukraine',
        scope_level: 'city',
        country_code: 'ua',
        country_name: 'Ukraine',
        admin1: 'Dnipropetrovsk Oblast',
        locality: 'Dnipro',
        bbox: '34.9500,48.4000,35.1500,48.5500',
        min_lng: 34.95,
        min_lat: 48.4,
        max_lng: 35.15,
        max_lat: 48.55,
        center_lat: 48.4647,
        center_lng: 35.0462,
      },
      moderationSettings: {
        duplicateRadiusM: 150,
        duplicateTimeHours: 24,
      },
      limit: 50,
    });

    expect(result.reports.map((report) => report.id)).toEqual(['DN-2', 'DN-1']);
    expect(result.outsideScopeExcluded).toBe(1);
    expect(result.duplicateReportsExcluded).toBe(1);
  });

  it('uses country scope to keep reports across the whole country', () => {
    const candidateReports = [
      {
        id: 'UA-1',
        lat: 48.4647,
        lng: 35.0462,
        submitted_at: '2026-06-13T20:20:00.000Z',
        location_id: 'ua-1',
        country_code: 'UA',
        status: 'verified',
      },
      {
        id: 'UA-2',
        lat: 50.4501,
        lng: 30.5234,
        submitted_at: '2026-06-13T19:20:00.000Z',
        location_id: 'ua-2',
        country_code: 'UA',
        status: 'verified',
      },
      {
        id: 'PL-1',
        lat: 52.2297,
        lng: 21.0122,
        submitted_at: '2026-06-13T18:20:00.000Z',
        location_id: 'pl-1',
        country_code: 'PL',
        status: 'verified',
      },
    ];

    const result = applySitrepScopeAndDedup({
      candidateReports,
      resolvedScope: {
        provider: 'nominatim',
        query: 'Ukraine',
        resolved_name: 'Ukraine',
        scope_level: 'country',
        country_code: 'ua',
        country_name: 'Ukraine',
        admin1: null,
        locality: null,
        bbox: null,
        min_lng: null,
        min_lat: null,
        max_lng: null,
        max_lat: null,
        center_lat: 49,
        center_lng: 32,
      },
      moderationSettings: {
        duplicateRadiusM: 150,
        duplicateTimeHours: 24,
      },
      limit: 50,
    });

    expect(result.reports.map((report) => report.id)).toEqual(['UA-1', 'UA-2']);
    expect(result.outsideScopeExcluded).toBe(1);
    expect(result.duplicateReportsExcluded).toBe(0);
  });

  it('keeps only reports inside a town-level bbox', () => {
    const candidateReports = [
      {
        id: 'TOWN-1',
        lat: 25.3200,
        lng: 68.2800,
        submitted_at: '2026-06-13T20:20:00.000Z',
        location_id: 'town-1',
        country_code: 'PK',
        status: 'verified',
      },
      {
        id: 'TOWN-2',
        lat: 25.3220,
        lng: 68.2810,
        submitted_at: '2026-06-13T19:20:00.000Z',
        location_id: 'town-2',
        country_code: 'PK',
        status: 'verified',
      },
      {
        id: 'OUTSIDE-TOWN',
        lat: 25.3960,
        lng: 68.3578,
        submitted_at: '2026-06-13T18:20:00.000Z',
        location_id: 'district-1',
        country_code: 'PK',
        status: 'verified',
      },
    ];

    const result = applySitrepScopeAndDedup({
      candidateReports,
      resolvedScope: {
        provider: 'nominatim',
        query: 'Rohri Town, Sindh, Pakistan',
        resolved_name: 'Rohri Town, Sindh, Pakistan',
        scope_level: 'town',
        country_code: 'pk',
        country_name: 'Pakistan',
        admin1: 'Sindh',
        locality: 'Rohri',
        bbox: '68.2500,25.3000,68.3000,25.3400',
        min_lng: 68.25,
        min_lat: 25.3,
        max_lng: 68.3,
        max_lat: 25.34,
        center_lat: 25.32,
        center_lng: 68.28,
      },
      moderationSettings: {
        duplicateRadiusM: 150,
        duplicateTimeHours: 24,
      },
      limit: 50,
    });

    expect(result.reports.map((report) => report.id)).toEqual(['TOWN-1', 'TOWN-2']);
    expect(result.outsideScopeExcluded).toBe(1);
    expect(result.duplicateReportsExcluded).toBe(0);
  });
});
