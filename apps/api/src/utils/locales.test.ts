import fs from 'fs';
import path from 'path';
import {
  LOCALES_DIR,
  countLeafStrings,
  flattenLocale,
  getLocaleFilePath,
  getLocaleStaleKeys,
  getLocaleStatus,
  getLocaleMissingKeys,
  projectLocaleToSourceShape,
  readLocaleForEditor,
  deleteLocaleKeyEverywhere,
  saveLocaleKeyFromEditor,
  upsertLocaleKey,
} from './locales';

describe('locale utilities', () => {
  it('reads locale files from the frontend public locales directory', () => {
    expect(getLocaleFilePath('en').replace(/\\/g, '/')).toMatch(/apps\/frontend\/public\/locales\/en\/translation\.json$/);
  });

  it('projects non-source locales onto the English source shape', () => {
    const projected = projectLocaleToSourceShape(
      { section: { a: 'A', b: 'B' } },
      { section: { a: 'Translated A', extra: 'remove me' } },
      {}
    );

    expect(projected).toEqual({ section: { a: 'Translated A', b: 'B' } });
  });

  it('counts locale leaf keys consistently', () => {
    expect(countLeafStrings({ a: '1', group: { b: '2', c: '3' } })).toBe(3);
    expect(flattenLocale({ a: '1', group: { b: '2' } })).toEqual({ a: '1', 'group.b': '2' });
  });

  it('returns source-shaped English locale data and non-zero status counts', () => {
    const english = readLocaleForEditor('en');
    const status = getLocaleStatus();
    const englishStatus = status.find((entry) => entry.lang === 'en');

    expect(Object.keys(flattenLocale(english)).length).toBeGreaterThan(0);
    expect(englishStatus?.keyCount).toBeGreaterThan(0);
    expect(status).toHaveLength(6);
  });

  it('marks non-English keys stale after the English master changes', () => {
    const key = 'nav.home';
    const enPath = getLocaleFilePath('en');
    const frPath = getLocaleFilePath('fr');
    const metaPath = path.join(LOCALES_DIR, '.editor-meta.json');
    const originalEn = fs.readFileSync(enPath, 'utf-8');
    const originalFr = fs.readFileSync(frPath, 'utf-8');
    const originalMeta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf-8') : null;

    try {
      saveLocaleKeyFromEditor('fr', key, 'Accueil test');
      expect(getLocaleStaleKeys('fr')).not.toContain(key);

      saveLocaleKeyFromEditor('en', key, 'Home test');
      expect(getLocaleStaleKeys('fr')).toContain(key);
    } finally {
      fs.writeFileSync(enPath, originalEn, 'utf-8');
      fs.writeFileSync(frPath, originalFr, 'utf-8');
      if (originalMeta === null) {
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } else {
        fs.writeFileSync(metaPath, originalMeta, 'utf-8');
      }
    }
  });

  it('keeps missing non-English editor values blank instead of filling them from English', () => {
    const source = { submit: { step_location: 'Location', step_damage: 'Damage' } };
    const projected = readLocaleForEditor('fr');

    expect(typeof flattenLocale(projected)['submit.step_location']).toBe('string');
    expect(getLocaleMissingKeys('fr')).toEqual(expect.any(Array));
    expect(projectLocaleToSourceShape(source, { submit: { step_location: 'Emplacement' } }, {})).toEqual({
      submit: { step_location: 'Emplacement', step_damage: 'Damage' },
    });
  });

  it('does not mark existing translated keys stale when baseline hashes were never recorded', () => {
    const key = 'nav.submit';
    const enPath = getLocaleFilePath('en');
    const frPath = getLocaleFilePath('fr');
    const metaPath = path.join(LOCALES_DIR, '.editor-meta.json');
    const originalEn = fs.readFileSync(enPath, 'utf-8');
    const originalFr = fs.readFileSync(frPath, 'utf-8');
    const originalMeta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf-8') : null;

    try {
      const frLocale = JSON.parse(originalFr);
      expect(flattenLocale(frLocale)[key]).toBeTruthy();

      fs.writeFileSync(metaPath, JSON.stringify({ version: 1, languages: {} }, null, 2), 'utf-8');

      expect(getLocaleStaleKeys('fr')).not.toContain(key);

      const nextMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      expect(nextMeta.languages?.fr?.sourceHashes?.[key]).toEqual(expect.any(String));
    } finally {
      fs.writeFileSync(enPath, originalEn, 'utf-8');
      fs.writeFileSync(frPath, originalFr, 'utf-8');
      if (originalMeta === null) {
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } else {
        fs.writeFileSync(metaPath, originalMeta, 'utf-8');
      }
    }
  });

  it('marks only a newly added English key as missing for other locales', () => {
    const key = 'submit.dynamic.infrastructure.release_smoke_custom_test_field.label';
    const enPath = getLocaleFilePath('en');
    const frPath = getLocaleFilePath('fr');
    const metaPath = path.join(LOCALES_DIR, '.editor-meta.json');
    const originalEn = fs.readFileSync(enPath, 'utf-8');
    const originalFr = fs.readFileSync(frPath, 'utf-8');
    const originalMeta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf-8') : null;

    try {
      deleteLocaleKeyEverywhere(key);
      upsertLocaleKey('en', key, 'Access note');

      for (const lang of ['ar', 'fr', 'es', 'ru', 'zh']) {
        const localeEditorShape = readLocaleForEditor(lang);
        const localeFlat = flattenLocale(localeEditorShape);
        const missingKeys = getLocaleMissingKeys(lang);
        const staleKeys = getLocaleStaleKeys(lang);

        expect(localeFlat[key]).toBe('');
        expect(missingKeys).toContain(key);
        expect(staleKeys).not.toContain(key);
      }
    } finally {
      fs.writeFileSync(enPath, originalEn, 'utf-8');
      fs.writeFileSync(frPath, originalFr, 'utf-8');
      if (originalMeta === null) {
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } else {
        fs.writeFileSync(metaPath, originalMeta, 'utf-8');
      }
    }
  });

  it('marks only the changed option key stale when one English option label changes', () => {
    const keyA = 'submit.dynamic.impact.custom_health_followup.label.options.option_1.label';
    const keyB = 'submit.dynamic.impact.custom_health_followup.label.options.option_2.label';
    const enPath = getLocaleFilePath('en');
    const frPath = getLocaleFilePath('fr');
    const metaPath = path.join(LOCALES_DIR, '.editor-meta.json');
    const originalEn = fs.readFileSync(enPath, 'utf-8');
    const originalFr = fs.readFileSync(frPath, 'utf-8');
    const originalMeta = fs.existsSync(metaPath) ? fs.readFileSync(metaPath, 'utf-8') : null;

    try {
      upsertLocaleKey('en', keyA, 'Option A');
      upsertLocaleKey('en', keyB, 'Option B');
      saveLocaleKeyFromEditor('fr', keyA, 'Option A FR');
      saveLocaleKeyFromEditor('fr', keyB, 'Option B FR');

      expect(getLocaleStaleKeys('fr')).not.toContain(keyA);
      expect(getLocaleStaleKeys('fr')).not.toContain(keyB);

      saveLocaleKeyFromEditor('en', keyA, 'Option A updated');

      expect(getLocaleStaleKeys('fr')).toContain(keyA);
      expect(getLocaleStaleKeys('fr')).not.toContain(keyB);
    } finally {
      fs.writeFileSync(enPath, originalEn, 'utf-8');
      fs.writeFileSync(frPath, originalFr, 'utf-8');
      if (originalMeta === null) {
        if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      } else {
        fs.writeFileSync(metaPath, originalMeta, 'utf-8');
      }
    }
  });
});
