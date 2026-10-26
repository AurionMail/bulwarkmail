import { describe, expect, it } from 'vitest';
import { stripBidiControls } from '@/lib/bidi';

describe('stripBidiControls', () => {
  it('removes the characters that reorder what the reader sees', () => {
    // An RTL override makes `report‮fdp.exe` read as `reportexe.pdf`.
    expect(stripBidiControls('report‮fdp.exe')).toBe('reportfdp.exe');
    expect(stripBidiControls('⁦a⁩‎b‏‪‫‬‭')).toBe('ab');
  });

  it('leaves ordinary text, including right-to-left scripts, alone', () => {
    expect(stripBidiControls('Rechnung März.pdf')).toBe('Rechnung März.pdf');
    expect(stripBidiControls('تقرير.pdf')).toBe('تقرير.pdf');
  });
});
