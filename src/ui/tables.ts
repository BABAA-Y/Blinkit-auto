export class Table {
  private readonly rows: string[][] = [];

  public constructor(private readonly headers: string[]) {}

  public addRow(row: string[]): void {
    this.rows.push(row);
  }

  public render(): string {
    if (this.rows.length === 0) return "  (No items)";

    const columnWidths = this.headers.map((h, i) => {
      const maxWidth = Math.max(
        h.length,
        ...this.rows.map(r => (r[i] !== undefined ? String(r[i]).length : 0))
      );
      return maxWidth;
    });

    const lines: string[] = [];

    const formatRow = (row: string[]) => {
      return "  " + row.map((cell, i) => {
        const val = cell !== undefined ? String(cell) : "";
        return val.padEnd(columnWidths[i]!);
      }).join("  |  ");
    };

    lines.push(formatRow(this.headers));
    const separator = columnWidths.map(w => "".padEnd(w, "-")).join("--+--");
    lines.push(`  ${separator}`);

    for (const row of this.rows) {
      lines.push(formatRow(row));
    }

    return lines.join("\n");
  }
}
