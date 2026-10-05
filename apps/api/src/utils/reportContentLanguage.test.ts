import { buildTranslationsObject, detectSourceLanguage, hasInvalidTranslationText, normalizeLanguageCode } from './reportContentLanguage';

describe('report content language helpers', () => {
  it('normalizes supported language codes', () => {
    expect(normalizeLanguageCode('fr-FR')).toBe('fr');
    expect(normalizeLanguageCode('AR')).toBe('ar');
    expect(normalizeLanguageCode('pt-BR')).toBeNull();
  });

  it('detects strong script-based languages from report text', () => {
    expect(detectSourceLanguage(['مدرسة متضررة قرب السوق']).language).toBe('ar');
    expect(detectSourceLanguage(['Повреждено здание рядом со школой']).language).toBe('ru');
    expect(detectSourceLanguage(['学校附近建筑受损']).language).toBe('zh');
  });

  it('falls back to hint-based detection for latin text', () => {
    const detected = detectSourceLanguage(['Daños en edificio cerca del mercado'], 'es');
    expect(detected.language).toBe('es');
    expect(detected.confidence).toBeGreaterThan(0.5);
  });

  it('groups translated fields by target language', () => {
    expect(buildTranslationsObject([
      { target_lang: 'en', field_name: 'description', translated_text: 'Damaged school' },
      { target_lang: 'en', field_name: 'address_text', translated_text: 'Near central market' },
    ])).toEqual({
      en: {
        description: 'Damaged school',
        address_text: 'Near central market',
      },
    });
  });

  it('filters stored safety metadata from translated fields', () => {
    expect(hasInvalidTranslationText('User Safety: unsafe\nSafety Categories: PII/Privacy')).toBe(true);
    expect(buildTranslationsObject([
      { target_lang: 'en', field_name: 'description', translated_text: 'User Safety: unsafe\nSafety Categories: PII/Privacy' },
      { target_lang: 'en', field_name: 'infra_name', translated_text: 'Courtyard homes' },
    ])).toEqual({
      en: {
        infra_name: 'Courtyard homes',
      },
    });
  });
});
