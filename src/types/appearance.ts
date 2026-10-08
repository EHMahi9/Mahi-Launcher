export type AccentPresetId = 'blue' | 'cyan' | 'purple' | 'green';

export interface AccentColorPreset {
  id: AccentPresetId;
  name: string;
  primary: string;
  hover: string;
  glow: string;
  subtle: string;
  border: string;
  gradient: string;
}

export type GlassIntensity = 'low' | 'medium' | 'high';
export type BlurStrength = 'subtle' | 'standard' | 'deep';
export type GlowIntensity = 'off' | 'subtle' | 'vibrant';

export interface AppearanceSettings {
  preset: AccentPresetId;
  glassIntensity: GlassIntensity;
  blurStrength: BlurStrength;
  glowIntensity: GlowIntensity;
}

export const ACCENT_PRESETS: Record<AccentPresetId, AccentColorPreset> = {
  blue: {
    id: 'blue',
    name: 'MAHI Blue',
    primary: '#2f7fff',
    hover: '#1b6ef5',
    glow: 'rgba(47, 127, 255, 0.22)',
    subtle: 'rgba(47, 127, 255, 0.12)',
    border: 'rgba(47, 127, 255, 0.35)',
    gradient: 'linear-gradient(135deg, #1b5edb 0%, #00d2ff 100%)',
  },
  cyan: {
    id: 'cyan',
    name: 'Cyan',
    primary: '#00d2ff',
    hover: '#00b4db',
    glow: 'rgba(0, 210, 255, 0.24)',
    subtle: 'rgba(0, 210, 255, 0.12)',
    border: 'rgba(0, 210, 255, 0.35)',
    gradient: 'linear-gradient(135deg, #0099cc 0%, #00e5ff 100%)',
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    primary: '#a855f7',
    hover: '#9333ea',
    glow: 'rgba(168, 85, 247, 0.24)',
    subtle: 'rgba(168, 85, 247, 0.12)',
    border: 'rgba(168, 85, 247, 0.35)',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #c084fc 100%)',
  },
  green: {
    id: 'green',
    name: 'Green',
    primary: '#10b981',
    hover: '#059669',
    glow: 'rgba(16, 185, 129, 0.24)',
    subtle: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.35)',
    gradient: 'linear-gradient(135deg, #047857 0%, #34d399 100%)',
  },
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  preset: 'blue',
  glassIntensity: 'medium',
  blurStrength: 'standard',
  glowIntensity: 'subtle',
};

const STORAGE_KEY = 'mahi_appearance_settings_v1';

export function loadAppearanceSettings(): AppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw);
    return {
      preset: ACCENT_PRESETS[parsed.preset as AccentPresetId] ? parsed.preset : DEFAULT_APPEARANCE.preset,
      glassIntensity: ['low', 'medium', 'high'].includes(parsed.glassIntensity)
        ? parsed.glassIntensity
        : DEFAULT_APPEARANCE.glassIntensity,
      blurStrength: ['subtle', 'standard', 'deep'].includes(parsed.blurStrength)
        ? parsed.blurStrength
        : DEFAULT_APPEARANCE.blurStrength,
      glowIntensity: ['off', 'subtle', 'vibrant'].includes(parsed.glowIntensity)
        ? parsed.glowIntensity
        : DEFAULT_APPEARANCE.glowIntensity,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function saveAppearanceSettings(settings: AppearanceSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save appearance settings:', e);
  }
}

export function applyAppearanceToDom(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const preset = ACCENT_PRESETS[settings.preset] || ACCENT_PRESETS.blue;

  // 1. Accent tokens
  root.style.setProperty('--mahi-accent-primary', preset.primary);
  root.style.setProperty('--mahi-accent-hover', preset.hover);
  root.style.setProperty('--mahi-accent-border', preset.border);
  root.style.setProperty('--mahi-accent-gradient', preset.gradient);

  // 2. Glow factor
  const glowAlpha = settings.glowIntensity === 'off' ? 0 : settings.glowIntensity === 'vibrant' ? 0.38 : 0.22;
  const glowColor = preset.glow.replace(/[\d\.]+\)$/, `${glowAlpha})`);
  root.style.setProperty('--mahi-accent-glow', glowColor);
  root.style.setProperty(
    '--mahi-accent-subtle',
    settings.glowIntensity === 'off' ? 'rgba(255, 255, 255, 0.04)' : preset.subtle
  );

  // 3. Glass opacities
  let surfaceOpacity = 0.72;
  let elevatedOpacity = 0.65;
  let modalOpacity = 0.94;

  if (settings.glassIntensity === 'low') {
    surfaceOpacity = 0.85;
    elevatedOpacity = 0.78;
    modalOpacity = 0.97;
  } else if (settings.glassIntensity === 'high') {
    surfaceOpacity = 0.56;
    elevatedOpacity = 0.50;
    modalOpacity = 0.88;
  }

  root.style.setProperty('--mahi-glass-surface', `rgba(7, 17, 31, ${surfaceOpacity})`);
  root.style.setProperty('--mahi-glass-elevated', `rgba(10, 22, 40, ${elevatedOpacity})`);
  root.style.setProperty(
    '--mahi-glass-elevated-hover',
    `rgba(14, 30, 54, ${Math.min(1, elevatedOpacity + 0.2)})`
  );
  root.style.setProperty('--mahi-glass-modal', `rgba(10, 22, 40, ${modalOpacity})`);

  // 4. Blur strength
  const blurPx = settings.blurStrength === 'subtle' ? '10px' : settings.blurStrength === 'deep' ? '24px' : '18px';
  root.style.setProperty('--mahi-glass-blur', blurPx);

  // 5. Specular highlight & border
  root.style.setProperty('--mahi-glass-highlight', 'rgba(255, 255, 255, 0.07)');
  root.style.setProperty('--mahi-glass-border', 'rgba(64, 128, 255, 0.14)');
  root.style.setProperty('--mahi-focus-ring', preset.primary);
}
