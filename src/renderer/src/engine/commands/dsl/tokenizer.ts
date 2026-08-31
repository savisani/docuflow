export interface Token {
  value: string;
  line: number;
  col: number;
}

export interface TokenLine {
  line: number;
  tokens: Token[];
}

export function tokenize(input: string): TokenLine[] {
  const lines = input.split('\n');
  const result: TokenLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const tokens: Token[] = [];
    let col = 0;

    while (col < trimmed.length) {
      while (col < trimmed.length && trimmed[col] === ' ') col++;
      if (col >= trimmed.length) break;

      if (trimmed[col] === '"') {
        let end = col + 1;
        while (end < trimmed.length && trimmed[end] !== '"') end++;
        const value = trimmed.slice(col + 1, end);
        tokens.push({ value, line: i + 1, col: col + 1 });
        col = end + 1;
      } else {
        let end = col;
        while (end < trimmed.length && trimmed[end] !== ' ') end++;
        const value = trimmed.slice(col, end);
        tokens.push({ value, line: i + 1, col: col + 1 });
        col = end;
      }
    }

    if (tokens.length > 0) {
      result.push({ line: i + 1, tokens });
    }
  }

  return result;
}
