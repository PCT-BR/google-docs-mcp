import { describe, expect, it } from 'vitest';
import {
  columnLettersToOneBased,
  oneBasedColumnsToDimensionRange,
  oneBasedRowsToDimensionRange,
} from './advancedLayout.js';

describe('advanced Sheets layout helpers', () => {
  it('converts one-based rows to Sheets dimension ranges', () => {
    expect(oneBasedRowsToDimensionRange(123, 2, 5)).toEqual({
      sheetId: 123,
      dimension: 'ROWS',
      startIndex: 1,
      endIndex: 5,
    });
  });

  it('converts one-based columns to Sheets dimension ranges', () => {
    expect(oneBasedColumnsToDimensionRange(123, 1, 3)).toEqual({
      sheetId: 123,
      dimension: 'COLUMNS',
      startIndex: 0,
      endIndex: 3,
    });
  });

  it('converts column letters to one-based indexes', () => {
    expect(columnLettersToOneBased('A')).toBe(1);
    expect(columnLettersToOneBased('Z')).toBe(26);
    expect(columnLettersToOneBased('AA')).toBe(27);
  });
});
