/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * `tint` is 藍 (ai), the indigo from caioalfonso.dev's design system, converted from its
 * OKLCH source: light `oklch(0.42 0.09 252)`, dark `oklch(0.62 0.10 250)`. React Native
 * cannot parse `oklch()`, so these are the exact sRGB conversions, not eyeballed hex.
 *
 * Every pair below is measured, because the greys alone could not carry selection state:
 * `backgroundSelected` against `background` is only 1.31:1 in light mode, which reads as
 * "nothing is selected".
 *
 *   tint on background   light 8.45:1   dark 5.78:1
 *   onTint on tint       light 8.45:1   dark 5.78:1
 *   danger on background light 6.54:1   dark 12.30:1
 *
 * `onTint` is black in dark mode on purpose: white on the lighter indigo is 3.63:1 and
 * fails AA. The rule is to pick the label colour that passes, not the one that looks tidy.
 */
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    tint: '#244f7c',
    onTint: '#ffffff',
    danger: '#b3261e',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    tint: '#558ac0',
    onTint: '#000000',
    danger: '#f2b8b5',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
