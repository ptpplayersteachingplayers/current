/**
 * PTP Mobile App - Forgot Password Screen
 *
 * Features:
 * - Email input for password reset
 * - Success message display
 * - Return to login
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import { LOGO, SCREEN_IMAGES } from '../constants/images';
import { AuthStackParamList } from '../types';
import { requestPasswordReset } from '../api/client';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);

  const validateEmail = (emailStr: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailStr);
  };

  const handleResetPassword = async () => {
    setError(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);

    try {
      await requestPasswordReset(trimmedEmail);
      setSuccess(true);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={styles.container}>
        <ImageBackground
          source={{ uri: SCREEN_IMAGES.loginBackground }}
          style={styles.heroBackground}
          resizeMode="cover"
        >
          <View style={styles.heroOverlay}>
            <SafeAreaView style={styles.heroContent}>
              <Image
                source={{ uri: LOGO.primary }}
                style={styles.logo}
                resizeMode="contain"
              />
            </SafeAreaView>
          </View>
        </ImageBackground>

        <View style={styles.formWrapper}>
          <View style={styles.formCard}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Check Your Email</Text>
            <Text style={styles.successText}>
              We've sent password reset instructions to{' '}
              <Text style={styles.emailHighlight}>{email}</Text>
            </Text>
            <Text style={styles.successSubtext}>
              If you don't see the email, check your spam folder.
            </Text>

            <PrimaryButton
              title="Return to Login"
              onPress={() => navigation.navigate('Login')}
              style={styles.returnButton}
            />

            <TouchableOpacity
              style={styles.resendButton}
              onPress={() => {
                setSuccess(false);
                setEmail('');
              }}
            >
              <Text style={styles.resendText}>Didn't receive it? Try again</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Hero Background */}
      <ImageBackground
        source={{ uri: SCREEN_IMAGES.loginBackground }}
        style={styles.heroBackground}
        resizeMode="cover"
      >
        <View style={styles.heroOverlay}>
          <SafeAreaView style={styles.heroContent}>
            <Image
              source={{ uri: LOGO.primary }}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.heroTitle}>Reset Password</Text>
            <Text style={styles.heroSubtitle}>
              We'll send you instructions to reset your password
            </Text>
          </SafeAreaView>
        </View>
      </ImageBackground>

      {/* Form */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.formWrapper}
        keyboardVerticalOffset={-100}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.formCard}>
            <Text style={styles.welcomeText}>Forgot Password?</Text>
            <Text style={styles.instructionText}>
              Enter the email address associated with your account and we'll send
              you a link to reset your password.
            </Text>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.grayLight}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                editable={!isLoading}
                onSubmitEditing={handleResetPassword}
              />
            </View>

            {/* Submit Button */}
            <PrimaryButton
              title="Send Reset Link"
              onPress={handleResetPassword}
              loading={isLoading}
              disabled={isLoading}
              style={styles.submitButton}
            />

            {/* Back to Login */}
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={styles.backButtonText}>← Back to Login</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink,
  },

  // Hero Section
  heroBackground: {
    height: SCREEN_HEIGHT * 0.32,
    width: '100%',
  },
  heroOverlay: {
    flex: 1,
    backgroundColor: 'rgba(14, 15, 17, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContent: {
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
  },
  logo: {
    width: 100,
    height: 66,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.white,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  heroSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.white,
    opacity: 0.9,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Form Section
  formWrapper: {
    flex: 1,
    marginTop: -spacing.xxl,
  },
  scrollContent: {
    flexGrow: 1,
  },
  formCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xxl,
  },

  // Form Content
  welcomeText: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  instructionText: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    marginBottom: spacing.xl,
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
  },

  // Error
  errorContainer: {
    backgroundColor: '#FEE2E2',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  errorText: {
    color: colors.error,
    fontSize: typography.sizes.sm,
    textAlign: 'center',
  },

  // Input
  inputGroup: {
    marginBottom: spacing.xl,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  input: {
    ...componentStyles.input,
  },
  inputFocused: {
    ...componentStyles.inputFocused,
  },

  // Button
  submitButton: {
    marginTop: spacing.md,
  },

  // Back Button
  backButton: {
    alignItems: 'center',
    marginTop: spacing.xl,
    padding: spacing.md,
  },
  backButtonText: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    fontWeight: typography.weights.medium,
  },

  // Success State
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  successIconText: {
    fontSize: 40,
    color: colors.white,
    fontWeight: typography.weights.bold,
  },
  successTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  successText: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
  },
  emailHighlight: {
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  successSubtext: {
    fontSize: typography.sizes.sm,
    color: colors.grayLight,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  returnButton: {
    marginTop: spacing.md,
  },
  resendButton: {
    alignItems: 'center',
    marginTop: spacing.xl,
    padding: spacing.sm,
  },
  resendText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});

export default ForgotPasswordScreen;
