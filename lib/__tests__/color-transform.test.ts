import { describe, it, expect } from 'vitest';
import {
  parseColor,
  getLuminance,
  readableTextOn,
} from '../color-transform';

describe('parseColor', () => {
  describe('hex colors', () => {
    it('should parse 6-digit hex colors', () => {
      expect(parseColor('#333333')).toEqual({ r: 51, g: 51, b: 51 });
      expect(parseColor('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 });
      expect(parseColor('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('should parse 3-digit hex colors', () => {
      expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseColor('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
      expect(parseColor('#000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('should handle uppercase and lowercase', () => {
      expect(parseColor('#aabbcc')).toEqual(parseColor('#AABBCC'));
      expect(parseColor('#fff')).toEqual(parseColor('#FFF'));
    });
  });

  describe('rgb/rgba colors', () => {
    it('should parse rgb colors', () => {
      expect(parseColor('rgb(51, 51, 51)')).toEqual({ r: 51, g: 51, b: 51 });
      expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('should parse rgba colors', () => {
      expect(parseColor('rgba(51, 51, 51, 0.5)')).toEqual({ r: 51, g: 51, b: 51, a: 0.5 });
      expect(parseColor('rgba(0, 0, 0, 0.8)')).toEqual({ r: 0, g: 0, b: 0, a: 0.8 });
    });

    it('should handle spaces in rgb/rgba', () => {
      expect(parseColor('rgb(51,51,51)')).toEqual({ r: 51, g: 51, b: 51 });
      expect(parseColor('rgba(51,  51,  51,  0.5)')).toEqual({ r: 51, g: 51, b: 51, a: 0.5 });
    });
  });

  describe('hsl/hsla colors', () => {
    it('should parse hsl colors', () => {
      const result = parseColor('hsl(0, 0%, 20%)');
      expect(result).toEqual({ r: 51, g: 51, b: 51 });
    });

    it('should parse hsla colors', () => {
      const result = parseColor('hsla(0, 0%, 20%, 0.5)');
      expect(result).toEqual({ r: 51, g: 51, b: 51, a: 0.5 });
    });

    it('should convert hsl to rgb correctly', () => {
      const red = parseColor('hsl(0, 100%, 50%)');
      expect(red).toEqual({ r: 255, g: 0, b: 0 });

      const green = parseColor('hsl(120, 100%, 50%)');
      expect(green).toEqual({ r: 0, g: 255, b: 0 });

      const blue = parseColor('hsl(240, 100%, 50%)');
      expect(blue).toEqual({ r: 0, g: 0, b: 255 });
    });
  });

  describe('named colors', () => {
    it('should parse named colors', () => {
      expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0 });
      expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255 });
      expect(parseColor('red')).toEqual({ r: 255, g: 0, b: 0 });
      expect(parseColor('green')).toEqual({ r: 0, g: 128, b: 0 });
      expect(parseColor('blue')).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('should handle transparent', () => {
      expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    });
  });

  describe('edge cases', () => {
    it('should return null for invalid colors', () => {
      expect(parseColor('invalid')).toBeNull();
      expect(parseColor('#GGGGGG')).toBeNull();
      expect(parseColor('rgb(300, 400, 500)')).toBeNull();
    });

    it('should return null for inherit and currentColor', () => {
      expect(parseColor('inherit')).toBeNull();
      expect(parseColor('currentColor')).toBeNull();
      expect(parseColor('currentcolor')).toBeNull();
    });

    it('should handle empty or invalid input', () => {
      expect(parseColor('')).toBeNull();
      expect(parseColor('   ')).toBeNull();
    });
  });
});

describe('getLuminance', () => {
  it('should calculate luminance for black', () => {
    expect(getLuminance(0, 0, 0)).toBe(0);
  });

  it('should calculate luminance for white', () => {
    expect(getLuminance(255, 255, 255)).toBe(1);
  });

  it('should calculate luminance for gray', () => {
    const luminance = getLuminance(128, 128, 128);
    expect(luminance).toBeGreaterThan(0);
    expect(luminance).toBeLessThan(1);
    expect(luminance).toBeCloseTo(0.215, 2);
  });

  it('should calculate luminance for dark colors', () => {
    const darkGray = getLuminance(51, 51, 51);
    expect(darkGray).toBeLessThan(0.5);
  });

  it('should calculate luminance for light colors', () => {
    const lightGray = getLuminance(200, 200, 200);
    expect(lightGray).toBeGreaterThan(0.5);
  });
});

describe('readableTextOn', () => {
  it('keeps white text while white holds 3:1 on the fill', () => {
    expect(readableTextOn('#3b82f6')).toBe('#ffffff');
    expect(readableTextOn('#8b5cf6')).toBe('#ffffff');
    expect(readableTextOn('rgb(236, 72, 153)')).toBe('#ffffff');
  });

  it('switches to dark text on light fills', () => {
    expect(readableTextOn('#22c55e')).toBe('#111827');
    expect(readableTextOn('#f59e0b')).toBe('#111827');
    expect(readableTextOn('#fff')).toBe('#111827');
  });

  it('falls back to white for colours it cannot parse', () => {
    expect(readableTextOn('not-a-colour')).toBe('#ffffff');
  });
});
