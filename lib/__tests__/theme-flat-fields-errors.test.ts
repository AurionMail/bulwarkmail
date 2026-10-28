import { describe, expect, it } from 'vitest';
import { flatFieldsSkin } from '../theme-flat-fields';

// Flat fields gives every field the control border with an unlayered rule,
// which also beat the red border of a field holding an error. A field that
// says it is invalid keeps the error colour.

function rulesFor(selectorPart: string) {
  return flatFieldsSkin.split('}').filter((block) => block.includes(selectorPart));
}

describe('Flat fields error borders', () => {
  it('colours an invalid field with the destructive colour, after the control-border rule', () => {
    const controlRule = flatFieldsSkin.indexOf('border-color: var(--color-input)');
    const errorRule = rulesFor('[aria-invalid="true"]').find((block) => block.includes('border-color: var(--color-destructive)'));
    expect(errorRule).toBeTruthy();
    expect(flatFieldsSkin.indexOf(errorRule!)).toBeGreaterThan(controlRule);
    // Same selector list plus the error condition, so it wins on specificity too.
    expect(errorRule).toContain(':is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea, .border-input):is(');
    expect(errorRule).toContain('.border-destructive');
  });

  it('no longer claims the global border rule outranks utilities', () => {
    expect(flatFieldsSkin).not.toContain('rule outranks utilities');
    expect(flatFieldsSkin).not.toContain('rule wins over\n   utilities');
  });
});
