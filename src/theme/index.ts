/**
 * PTP Mobile App - Theme Configuration
 *
 * Brand: Players Teaching Players (PTP) Soccer Camps
 * Style: Clean, modern, sports-brand feel (Nike/US Sports Camps inspired)
 */

export const colors = {
  // Primary brand colors
  primary: '#FCB900',      // PTP Yellow - main CTA color
  ink: '#0E0F11',          // Ink Black - primary text
  offWhite: '#F4F3F0',     // Off-White - screen backgrounds
  white: '#FFFFFF',        // Pure white - card backgrounds

  // Secondary colors
  gray: '#6B7280',         // Muted text, secondary info
  grayLight: '#9CA3AF',    // Placeholder text, disabled states
  border: '#E5E7EB',       // Card borders, dividers

  // Semantic colors
  success: '#10B981',      // Green - success states
  error: '#EF4444',        // Red - error states
  warning: '#F59E0B',      // Amber - warning states
  info: '#3B82F6',         // Blue - info states

  // Badge colors
  badgeBestSeller: '#10B981',  // Green for "Best Seller"
  badgeAlmostFull: '#EF4444',  // Red for "Almost Full"

  // Transparent overlays
  overlay: 'rgba(14, 15, 17, 0.5)',

  // Shadow color for iOS
  shadow: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  full: 9999,
} as const;

export const typography = {
  // Font sizes
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    xxxl: 32,
  },

  // Font weights (system font compatible)
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  // Line heights
  lineHeights: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const shadows = {
  sm: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  lg: {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
} as const;

// Common component styles
export const componentStyles = {
  // Card style for list items
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.md,
  },

  // Screen container
  screenContainer: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },

  // Content padding
  contentPadding: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },

  // Input field style
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: typography.sizes.md,
    color: colors.ink,
  },

  // Input focused state
  inputFocused: {
    borderColor: colors.primary,
  },
} as const;

// Theme object for easy importing
const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
  shadows,
  componentStyles,
};

export default theme;

// Type exports for TypeScript
export type Colors = typeof colors;
export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
export type Typography = typeof typography;
export type Shadows = typeof shadows;
