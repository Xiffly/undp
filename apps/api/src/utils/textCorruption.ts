export type TextCorruptionIssueCode =
  | 'mojibake_token'
  | 'replacement_glyph'
  | 'question_run'
  | 'latin_question'
  | 'box_drawing';

export type TextCorruptionIssue = {
  code: TextCorruptionIssueCode;
  sample: string;
};

const MOJIBAKE_TOKENS = [
  'Ãƒ',
  'Ã‚',
  'Ã\x90',
  'Ã\x91',
  'Ã\x98',
  'Ã\x99',
  'Ã„Â±',
  'Ä±',
  'Ã¯Â¿Â½',
  'ï¿½',
];
const BOX_DRAWING_RE = /[\u2500-\u259f]/;
const LATIN_QUESTION_RE = /[A-Za-z\u00c0-\u024f]\?[A-Za-z\u00c0-\u024f]/;

export function inspectTextCorruption(value: unknown): TextCorruptionIssue[] {
  if (typeof value !== 'string' || !value) return [];

  const issues: TextCorruptionIssue[] = [];
  for (const token of MOJIBAKE_TOKENS) {
    if (value.includes(token)) {
      issues.push({ code: 'mojibake_token', sample: token });
      break;
    }
  }

  if (value.includes('ï¿½')) {
    issues.push({ code: 'replacement_glyph', sample: 'ï¿½' });
  }

  const questionRun = value.match(/\?{2,}/);
  if (questionRun) {
    issues.push({ code: 'question_run', sample: questionRun[0] });
  }

  const latinQuestion = value.match(LATIN_QUESTION_RE);
  if (latinQuestion) {
    issues.push({ code: 'latin_question', sample: latinQuestion[0] });
  }

  const boxDrawing = value.match(BOX_DRAWING_RE);
  if (boxDrawing) {
    issues.push({ code: 'box_drawing', sample: boxDrawing[0] });
  }

  return issues;
}

export function hasTextCorruption(value: unknown): boolean {
  return inspectTextCorruption(value).length > 0;
}
