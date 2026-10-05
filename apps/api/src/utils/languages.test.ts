import { DEFAULT_LANGUAGE, isSupportedLanguage, SUPPORTED_LANGUAGE_CODES, SUPPORTED_LANGUAGES } from './languages';

describe('shared language configuration', () => {
  it('loads the six required UN languages from the shared source', () => {
    expect([...SUPPORTED_LANGUAGE_CODES].sort()).toEqual(['ar', 'en', 'es', 'fr', 'ru', 'zh']);
    expect(SUPPORTED_LANGUAGES).toHaveLength(6);
  });

  it('has a single default master language', () => {
    expect(DEFAULT_LANGUAGE).toBe('en');
    expect(SUPPORTED_LANGUAGES.filter((language) => language.master)).toHaveLength(1);
  });

  it('validates supported language codes consistently', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('AR')).toBe(true);
    expect(isSupportedLanguage('pt')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
  });
});
