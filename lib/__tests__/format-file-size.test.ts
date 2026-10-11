import { describe, expect, it } from 'vitest';
import { formatFileSize } from '../utils';

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [410, '410 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [2150, '2.1 KB'],
    [68_659, '67 KB'],
    [148_480, '145 KB'],
    [1024 * 1024 - 300, '1 MB'],
    [3.46 * 1024 * 1024, '3.5 MB'],
    [12.7 * 1024 * 1024, '13 MB'],
    [5 * 1024 ** 3, '5 GB'],
    [-1, '0 B'],
    [Number.NaN, '0 B'],
  ])('%s bytes reads as %s', (bytes, text) => {
    expect(formatFileSize(bytes)).toBe(text);
  });
});
