import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  ACCENT_PRESETS,
  loadAppearanceSettings,
  saveAppearanceSettings,
  applyAppearanceToDom,
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

  it('loads default appearance when storage is empty', () => {
    const settings = loadAppearanceSettings();
    expect(settings).toEqual(DEFAULT_APPEARANCE);
    expect(settings.preset).toBe('blue');
    expect(settings.glassIntensity).toBe('medium');
    expect(settings.blurStrength).toBe('standard');
    expect(settings.glowIntensity).toBe('subtle');
  });

  it('saves and reloads custom appearance settings', () => {
    const custom: AppearanceSettings = {
      preset: 'purple',
      glassIntensity: 'high',
      blurStrength: 'deep',
      glowIntensity: 'vibrant',
    };

    saveAppearanceSettings(custom);
    const loaded = loadAppearanceSettings();
    expect(loaded).toEqual(custom);
  });

  it('handles corrupted localStorage gracefully by returning defaults', () => {
    localStorage.setItem('mahi_appearance_settings_v1', 'invalid-json{{{');
    const loaded = loadAppearanceSettings();
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

  it('applies subtle blur and glow off properly', () => {
    const minimalSettings: AppearanceSettings = {
      preset: 'green',
      glassIntensity: 'high',
      blurStrength: 'subtle',
      glowIntensity: 'off',
    };

    applyAppearanceToDom(minimalSettings);
    const style = document.documentElement.style;

    expect(style.getPropertyValue('--mahi-accent-primary')).toBe(ACCENT_PRESETS.green.primary);
    expect(style.getPropertyValue('--mahi-glass-blur')).toBe('10px');
    expect(style.getPropertyValue('--mahi-glass-surface')).toContain('0.56');
    expect(style.getPropertyValue('--mahi-accent-glow')).toContain('0)');
  });
});
