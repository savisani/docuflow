export interface DslError {
  line: number;
  message: string;
}

export function formatDslErrors(errors: DslError[]): string {
  if (errors.length === 0) return '';
  return errors.map((e) => `Line ${e.line}: ${e.message}`).join('\n');
}
