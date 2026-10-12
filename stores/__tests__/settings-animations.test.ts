import { describe, it, expect } from 'vitest';
import { useSettingsStore } from '../settings-store';

describe('animations setting (#1215)', () => {
  it('marks the page so the stylesheet can stop every animation, and unmarks it again', () => {
    useSettingsStore.getState().updateSetting('animationsEnabled', false);
    expect(document.documentElement.dataset.animations).toBe('off');

    useSettingsStore.getState().updateSetting('animationsEnabled', true);
    expect(document.documentElement.dataset.animations).toBeUndefined();
  });
});
