import { encodeCsvForSpreadsheet } from './csvEncoding';
import { hasTextCorruption, inspectTextCorruption } from './textCorruption';

describe('text corruption audit', () => {
  it('flags mojibake tokens', () => {
    expect(hasTextCorruption('KÄ±rÄ±khan District, Hatay Province, Turkey')).toBe(true);
    expect(inspectTextCorruption('KÄ±rÄ±khan District, Hatay Province, Turkey')[0]?.code).toBe('mojibake_token');
  });

  it('flags replacement question runs', () => {
    const issues = inspectTextCorruption('??????????');
    expect(issues.some((issue) => issue.code === 'question_run')).toBe(true);
  });

  it('flags box-drawing artifacts from corrupted text', () => {
    const issues = inspectTextCorruption('Report ┐└┘ title');
    expect(issues.some((issue) => issue.code === 'box_drawing')).toBe(true);
  });

  it('does not flag clean multilingual text', () => {
    expect(hasTextCorruption('Kırıkhan District, Hatay Province, Turkey')).toBe(false);
    expect(hasTextCorruption('العربية')).toBe(false);
    expect(hasTextCorruption('Русский')).toBe(false);
    expect(hasTextCorruption('中文')).toBe(false);
  });
});

describe('csv encoding', () => {
  it('prepends a UTF-8 BOM for spreadsheet compatibility', () => {
    const encoded = encodeCsvForSpreadsheet('id,name\n1,Kırıkhan');
    expect(encoded.charCodeAt(0)).toBe(0xfeff);
    expect(encoded.startsWith('\uFEFFid,name')).toBe(true);
  });
});
