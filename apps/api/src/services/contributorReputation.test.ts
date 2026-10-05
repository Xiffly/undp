import { describe, expect, it } from 'vitest';
import {
  buildBadgeSet,
  computeCompletenessScore,
  computeLevel,
  computeLocationPrecisionScore,
  computeWeightedQuality,
  pickPrimaryBadge,
} from './contributorReputation';

describe('contributorReputation', () => {
  it('computes weighted quality score', () => {
    expect(computeWeightedQuality({
      report_id: 'r1',
      accuracy_score: 100,
      photo_quality_score: 80,
      location_precision_score: 90,
      completeness_score: 70,
      useful_infrastructure_details: false,
      confirms_existing_damage: false,
      new_coverage_location: false,
    })).toBe(89);
  });

  it('maps points to the requested level thresholds', () => {
    expect(computeLevel(0)).toBe('contributor');
    expect(computeLevel(50)).toBe('active_contributor');
    expect(computeLevel(150)).toBe('trusted_contributor');
    expect(computeLevel(400)).toBe('community_mapper');
    expect(computeLevel(800)).toBe('crisis_response_champion');
  });

  it('applies badge conditions and primary badge priority', () => {
    const badges = buildBadgeSet({
      reportsVerified: 25,
      validationRate: 0.9,
      distinctInfraTypes: 6,
      distinctLanguages: 2,
      distinctCrises: 2,
      newCoverageReports: 3,
      usefulDetailReports: 5,
      highQualityVerifiedReports: 5,
      confirmationsMade: 6,
      firstVerifiedExists: true,
      earlyResponder: true,
      hasCommunityHero: false,
    });
    expect(badges).toContain('trusted_reporter');
    expect(badges).toContain('coverage_champion');
    expect(badges).toContain('verification_helper');
    expect(pickPrimaryBadge(badges)).toBe('trusted_reporter');
  });

  it('scores completeness and location precision from structured inputs', () => {
    expect(computeCompletenessScore({
      addressText: 'Main road block',
      infraName: 'Bridge 7',
      description: 'Major structural failure with debris',
      pressingNeeds: ['infrastructure', 'shelter'],
      photosCount: 3,
      infraTypes: ['transport'],
    })).toBeGreaterThan(80);
    expect(computeLocationPrecisionScore({
      locationCaptureMode: 'gps',
      lat: 10,
      lng: 20,
    })).toBe(95);
  });
});
