import { Table } from "./tables.js";

export class TerminalUI {
  public success(message: string): void {
    console.log(`\n  ✓ ${message}`);
  }

  public error(message: string): void {
    console.log(`\n  ✗ ${message}`);
  }

  public warning(message: string): void {
    console.log(`\n  ⚠ ${message}`);
  }

  public info(message: string): void {
    console.log(`\n  ℹ ${message}`);
  }

  public header(title: string): void {
    console.log(`\n=== ${title.toUpperCase()} ===\n`);
  }

  public message(msg: string): void {
    console.log(`  ${msg.replace(/\n/g, "\n  ")}`);
  }

  public printTable(headers: string[], rows: string[][]): void {
    const table = new Table(headers);
    for (const row of rows) table.addRow(row);
    console.log(`\n${table.render()}\n`);
  }

  public printObject(obj: Record<string, any>): void {
    const maxKeyLength = Math.max(...Object.keys(obj).map(k => k.length));
    console.log();
    for (const [key, value] of Object.entries(obj)) {
      console.log(`  ${key.padEnd(maxKeyLength)} : ${value}`);
    }
    console.log();
  }
}
