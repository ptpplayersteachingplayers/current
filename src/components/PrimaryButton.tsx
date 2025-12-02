import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  StyleProp,
} from 'react-native';
import { colors, spacing, borderRadius, typography } from '../theme';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'lg',
  style,
  textStyle,
}) => {
  const isDisabled = disabled || loading;

  const getSizeStyle = () => {
    switch (size) {
      case 'sm':
        return styles.button_sm;
      case 'md':
        return styles.button_md;
      default:
        return styles.button_lg;
    }
  };

  const getVariantStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.buttonSecondary;
      case 'outline':
        return styles.buttonOutline;
      default:
        return styles.buttonPrimary;
    }
  };

  const getTextSizeStyle = () => {
    switch (size) {
      case 'sm':
        return styles.buttonText_sm;
      case 'md':
        return styles.buttonText_md;
      default:
        return styles.buttonText_lg;
    }
  };

  const getTextVariantStyle = () => {
    switch (variant) {
      case 'secondary':
        return styles.buttonTextSecondary;
      case 'outline':
        return styles.buttonTextOutline;
      default:
        return styles.buttonTextPrimary;
    }
  };

  const buttonStyles: StyleProp<ViewStyle> = [
    styles.button,
    getSizeStyle(),
    getVariantStyle(),
    isDisabled && styles.buttonDisabled,
    style,
  ];

  const textStyles: StyleProp<TextStyle> = [
    styles.buttonText,
    getTextSizeStyle(),
    getTextVariantStyle(),
    isDisabled && styles.buttonTextDisabled,
    textStyle,
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'outline' ? colors.ink : colors.ink}
          size="small"
        />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
  },

  // Size variants
  button_sm: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    minHeight: 36,
  },
  button_md: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    minHeight: 44,
  },
  button_lg: {
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xxl,
    minHeight: 52,
  },

  // Variant styles
  buttonPrimary: {
    backgroundColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.ink,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: colors.ink,
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // Text styles
  buttonText: {
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
  },
  buttonText_sm: {
    fontSize: typography.sizes.sm,
  },
  buttonText_md: {
    fontSize: typography.sizes.md,
  },
  buttonText_lg: {
    fontSize: typography.sizes.lg,
  },

  // Text variant styles
  buttonTextPrimary: {
    color: colors.ink,
  },
  buttonTextSecondary: {
    color: colors.white,
  },
  buttonTextOutline: {
    color: colors.ink,
  },
  buttonTextDisabled: {
    color: colors.gray,
  },
});

export default PrimaryButton;
