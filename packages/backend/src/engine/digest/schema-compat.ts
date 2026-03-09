import { listTableColumns } from '../../db/client.js';

export function hasRequiredColumns(tableName: string, requiredColumns: string[]): boolean {
  const rows = listTableColumns(tableName);
  if (rows.length === 0) {
    return false;
  }

  const existing = new Set(rows);
  return requiredColumns.every((column) => existing.has(column));
}
