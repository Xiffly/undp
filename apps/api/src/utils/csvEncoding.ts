export function encodeCsvForSpreadsheet(csv: string): string {
  return `\uFEFF${csv}`;
}
