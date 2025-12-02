import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../theme';

type BadgeVariant = 'bestseller' | 'almostFull' | 'success' | 'warning' | 'info';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  style?: ViewStyle;
}

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'info',
  style,
}) => {
  const getBackgroundColor = (): string => {
    switch (variant) {
      case 'bestseller':
        return colors.badgeBestSeller;
      case 'almostFull':
        return colors.badgeAlmostFull;
      case 'success':
        return colors.success;
      case 'warning':
        return colors.warning;
      case 'info':
      default:
        return colors.info;
    }
  };

  return (
    <View style={[styles.badge, { backgroundColor: getBackgroundColor() }, style]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

export default Badge;
