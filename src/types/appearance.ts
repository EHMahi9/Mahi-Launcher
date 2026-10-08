export type AccentPresetId = 'blue' | 'cyan' | 'purple' | 'green' | 'custom';

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
  customColor?: string;
  glassIntensity: GlassIntensity;
  blurStrength: BlurStrength;
  glowIntensity: GlowIntensity;
}

export const ACCENT_PRESETS: Record<Exclude<AccentPresetId, 'custom'>, AccentColorPreset> = {
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
  customColor: undefined,
  glassIntensity: 'medium',
  blurStrength: 'standard',
  glowIntensity: 'subtle',
};

export function isValidHexColor(hex: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(hex.trim());
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim();
  if (!isValidHexColor(clean)) return null;
  const num = parseInt(clean.slice(1), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function generateCustomPreset(customColor: string): AccentColorPreset {
  const rgb = hexToRgb(customColor) || { r: 47, g: 127, b: 255 };
  const primary = isValidHexColor(customColor) ? customColor.toLowerCase() : '#2f7fff';
  const hoverR = Math.max(0, Math.min(255, Math.round(rgb.r * 0.88)));
  const hoverG = Math.max(0, Math.min(255, Math.round(rgb.g * 0.88)));
  const hoverB = Math.max(0, Math.min(255, Math.round(rgb.b * 0.88)));
  const hover = `#${hoverR.toString(16).padStart(2, '0')}${hoverG.toString(16).padStart(2, '0')}${hoverB.toString(16).padStart(2, '0')}`;

  return {
    id: 'custom',
    name: 'Custom Accent',
    primary,
    hover,
    glow: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.24)`,
    subtle: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
    border: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`,
    gradient: `linear-gradient(135deg, ${primary} 0%, rgba(${Math.min(255, rgb.r + 40)}, ${Math.min(255, rgb.g + 40)}, ${Math.min(255, rgb.b + 40)}, 1) 100%)`,
  };
}

export function getPresetDefinition(settings: AppearanceSettings): AccentColorPreset {
  if (settings.preset === 'custom' && settings.customColor && isValidHexColor(settings.customColor)) {
    return generateCustomPreset(settings.customColor);
  }
  const key = settings.preset as Exclude<AccentPresetId, 'custom'>;
  return ACCENT_PRESETS[key] || ACCENT_PRESETS.blue;
}

const STORAGE_KEY = 'mahi_appearance_settings_v1';

export function loadAppearanceFallback(): AppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw);
    const validPresets: AccentPresetId[] = ['blue', 'cyan', 'purple', 'green', 'custom'];
    const preset = validPresets.includes(parsed.preset) ? parsed.preset : DEFAULT_APPEARANCE.preset;
    const customColor = parsed.customColor && isValidHexColor(parsed.customColor) ? parsed.customColor : undefined;

    return {
      preset: preset === 'custom' && !customColor ? 'blue' : preset,
      customColor,
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

export function saveAppearanceFallback(settings: AppearanceSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save appearance fallback:', e);
  }
}

export function applyAppearanceToDom(settings: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const preset = getPresetDefinition(settings);

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
