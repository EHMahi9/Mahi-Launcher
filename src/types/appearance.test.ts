import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  ACCENT_PRESETS,
  loadAppearanceFallback,
  saveAppearanceFallback,
  applyAppearanceToDom,
  isValidHexColor,
  generateCustomPreset,
  getPresetDefinition,
  AppearanceSettings
} from './appearance';

describe('Appearance Token System & Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('style');
  });

  it('validates hex colors correctly', () => {
    expect(isValidHexColor('#2f7fff')).toBe(true);
    expect(isValidHexColor('#ff00aa')).toBe(true);
    expect(isValidHexColor('#123456')).toBe(true);
    expect(isValidHexColor('#FFF')).toBe(false); // only 6 digits
    expect(isValidHexColor('blue')).toBe(false);
    expect(isValidHexColor('#zzz123')).toBe(false);
    expect(isValidHexColor('')).toBe(false);
  });

  it('generates custom preset from hex with computed glow, hover, and subtle values', () => {
    const custom = generateCustomPreset('#ff5500');
    expect(custom.id).toBe('custom');
    expect(custom.name).toBe('Custom Accent');
    expect(custom.primary).toBe('#ff5500');
    expect(custom.glow).toContain('rgba(255, 85, 0');
    expect(custom.subtle).toContain('rgba(255, 85, 0, 0.12)');
  });

  it('loads default appearance when fallback storage is empty', () => {
    const settings = loadAppearanceFallback();
    expect(settings).toEqual(DEFAULT_APPEARANCE);
    expect(settings.preset).toBe('blue');
    expect(settings.customColor).toBeUndefined();
    expect(settings.glassIntensity).toBe('medium');
    expect(settings.blurStrength).toBe('standard');
    expect(settings.glowIntensity).toBe('subtle');
  });

  it('saves and reloads custom appearance settings with customColor', () => {
    const custom: AppearanceSettings = {
      preset: 'custom',
      customColor: '#e11d48',
      glassIntensity: 'high',
      blurStrength: 'deep',
      glowIntensity: 'vibrant',
    };

    saveAppearanceFallback(custom);
    const loaded = loadAppearanceFallback();
    expect(loaded).toEqual(custom);
  });

  it('handles corrupted storage gracefully by returning defaults', () => {
    localStorage.setItem('mahi_appearance_settings_v1', 'invalid-json{{{');
    const loaded = loadAppearanceFallback();
    expect(loaded).toEqual(DEFAULT_APPEARANCE);
  });

  it('applies default MAHI Blue CSS tokens to document root', () => {
    applyAppearanceToDom(DEFAULT_APPEARANCE);
    const style = document.documentElement.style;

    expect(style.getPropertyValue('--mahi-accent-primary')).toBe(ACCENT_PRESETS.blue.primary);
    expect(style.getPropertyValue('--mahi-accent-hover')).toBe(ACCENT_PRESETS.blue.hover);
    expect(style.getPropertyValue('--mahi-accent-border')).toBe(ACCENT_PRESETS.blue.border);
    expect(style.getPropertyValue('--mahi-glass-blur')).toBe('18px');
    expect(style.getPropertyValue('--mahi-focus-ring')).toBe(ACCENT_PRESETS.blue.primary);
  });

  it('applies Custom Accent Color to document root dynamically', () => {
    const customSettings: AppearanceSettings = {
      preset: 'custom',
      customColor: '#ec4899',
      glassIntensity: 'medium',
      blurStrength: 'standard',
      glowIntensity: 'subtle',
    };

    applyAppearanceToDom(customSettings);
    const style = document.documentElement.style;

    expect(style.getPropertyValue('--mahi-accent-primary')).toBe('#ec4899');
    expect(style.getPropertyValue('--mahi-focus-ring')).toBe('#ec4899');
    expect(style.getPropertyValue('--mahi-accent-glow')).toContain('236, 72, 153');
  });

  it('falls back to MAHI Blue if preset is custom but customColor is invalid', () => {
    const invalidCustom: AppearanceSettings = {
      preset: 'custom',
      customColor: 'invalid',
      glassIntensity: 'medium',
      blurStrength: 'standard',
      glowIntensity: 'subtle',
    };

    const def = getPresetDefinition(invalidCustom);
    expect(def.primary).toBe(ACCENT_PRESETS.blue.primary);
  });

  it('applies Cyan preset tokens with deep blur and vibrant glow', () => {
    const cyanSettings: AppearanceSettings = {
      preset: 'cyan',
      glassIntensity: 'low',
      blurStrength: 'deep',
      glowIntensity: 'vibrant',
    };

    applyAppearanceToDom(cyanSettings);
    const style = document.documentElement.style;

    expect(style.getPropertyValue('--mahi-accent-primary')).toBe(ACCENT_PRESETS.cyan.primary);
    expect(style.getPropertyValue('--mahi-glass-blur')).toBe('24px');
    expect(style.getPropertyValue('--mahi-glass-surface')).toContain('0.85');
    expect(style.getPropertyValue('--mahi-accent-glow')).toContain('0.38');
  });
});
