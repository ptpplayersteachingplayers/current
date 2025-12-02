import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography, borderRadius } from '../theme';
import { PrimaryButton } from './PrimaryButton';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  message = 'Something went wrong. Please try again.',
  onRetry,
  retryLabel = 'Try Again',
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>!</Text>
      </View>
      <Text style={styles.title}>Oops!</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <PrimaryButton
          title={retryLabel}
          onPress={onRetry}
          variant="outline"
          size="md"
          style={styles.button}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    backgroundColor: colors.offWhite,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.full,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 32,
    fontWeight: typography.weights.bold,
    color: colors.white,
  },
  title: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  message: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
    marginBottom: spacing.xl,
  },
  button: {
    minWidth: 140,
  },
});

export default ErrorState;
