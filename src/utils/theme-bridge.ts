import { setTheme } from '@inspektor-gadget/ig-desktop/frontend';

/**
 * Bridge MUI theme tokens into IG CSS custom properties.
 * Call this whenever the Headlamp theme changes.
 */
export function bridgeTheme(muiTheme: any) {
  const palette = muiTheme?.palette;
  const typography = muiTheme?.typography;
  const shape = muiTheme?.shape;

  if (!palette) return;

  setTheme({
    primary: palette.primary?.main,
    primaryHover: palette.primary?.dark,
    primaryMuted: palette.primary?.light,
    surface: palette.background?.paper,
    surfaceRaised: palette.background?.default,
    text: palette.text?.primary,
    textSecondary: palette.text?.secondary,
    textMuted: palette.text?.disabled,
    textOnPrimary: palette.primary?.contrastText,
    border: palette.divider,
    error: palette.error?.main,
    success: palette.success?.main,
    warning: palette.warning?.main,
    radiusMd: shape?.borderRadius ? `${shape.borderRadius}px` : undefined,
    fontSans: typography?.fontFamily,
    fontMono: typography?.fontFamilyMonospace || '"Roboto Mono", monospace',
  });
}

