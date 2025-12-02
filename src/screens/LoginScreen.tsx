/**
 * PTP Mobile App - Login Screen
 *
 * Features:
 * - Hero background image with overlay
 * - Real PTP logo
 * - Email/username and password inputs
 * - PTP branded styling
 * - Loading state during login
 * - Error handling with clear messages
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
import { useAuth } from '../context/AuthContext';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import { LOGO, SCREEN_IMAGES } from '../constants/images';
import { AuthStackParamList } from '../types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

const LoginScreen: React.FC<Props> = ({ navigation }) => {
  const { login, isLoading, continueAsGuest } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    // Clear previous errors
    setError(null);

    // Validate inputs
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail) {
      setError('Please enter your email or username.');
      return;
    }

    if (!trimmedPassword) {
      setError('Please enter your password.');
      return;
    }

    try {
      await login({
        username: trimmedEmail,
        password: trimmedPassword,
      });
      // Success - navigation will happen automatically via AuthContext
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    }
  };

  return (
    <View style={styles.container}>
      {/* Hero Background Image */}
      <ImageBackground
        source={{ uri: SCREEN_IMAGES.loginBackground }}
        style={styles.heroBackground}
        resizeMode="cover"
      >
        <View style={styles.heroOverlay}>
          <SafeAreaView style={styles.heroContent}>
            {/* Logo */}
            <Image
              source={{ uri: LOGO.primary }}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.heroTitle}>Players Teaching Players</Text>
            <Text style={styles.heroSubtitle}>
              Where NCAA & pro athletes coach the next generation
            </Text>
          </SafeAreaView>
        </View>
      </ImageBackground>

      {/* Login Form Card */}
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
            {/* Create Account CTA - Prominent at top */}
            <View style={styles.createAccountBanner}>
              <Text style={styles.bannerText}>New to PTP Soccer?</Text>
              <TouchableOpacity
                style={styles.createAccountButton}
                onPress={() => navigation.navigate('Register')}
              >
                <Text style={styles.createAccountButtonText}>Create Free Account</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or sign in</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email or Username</Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
                placeholderTextColor={colors.grayLight}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                editable={!isLoading}
              />
            </View>

            {/* Password Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={[styles.input, passwordFocused && styles.inputFocused]}
                value={password}
                onChangeText={setPassword}
                placeholder="Enter your password"
                placeholderTextColor={colors.grayLight}
                secureTextEntry
                textContentType="password"
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                editable={!isLoading}
                onSubmitEditing={handleLogin}
              />
            </View>

            {/* Login Button */}
            <PrimaryButton
              title="Log In"
              onPress={handleLogin}
              loading={isLoading}
              disabled={isLoading}
              style={styles.loginButton}
            />

            {/* Continue as Guest Button */}
            <TouchableOpacity
              style={styles.guestButton}
              onPress={continueAsGuest}
              disabled={isLoading}
            >
              <Text style={styles.guestButtonText}>Continue as Guest</Text>
            </TouchableOpacity>

            {/* Forgot Password Link */}
            <TouchableOpacity
              style={styles.forgotPasswordButton}
              onPress={() => navigation.navigate('ForgotPassword')}
            >
              <Text style={styles.forgotPasswordText}>Forgot your password?</Text>
            </TouchableOpacity>

            {/* Footer */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => navigation.navigate('Register')}>
                <Text style={styles.footerLink}>Create Account</Text>
              </TouchableOpacity>
            </View>
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
    height: SCREEN_HEIGHT * 0.38,
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
    width: 120,
    height: 80,
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
    minHeight: SCREEN_HEIGHT * 0.65,
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
    marginBottom: spacing.lg,
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
  loginButton: {
    marginTop: spacing.md,
  },

  // Guest Button
  guestButton: {
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.white,
  },
  guestButtonText: {
    fontSize: typography.sizes.md,
    color: colors.ink,
    fontWeight: typography.weights.medium,
  },

  // Forgot Password
  forgotPasswordButton: {
    alignItems: 'center',
    marginTop: spacing.xl,
    padding: spacing.sm,
  },
  forgotPasswordText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    textDecorationLine: 'underline',
  },

  // Footer
  footer: {
    marginTop: 'auto',
    paddingTop: spacing.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  footerLink: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },

  // Create Account Banner
  createAccountBanner: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    alignItems: 'center',
  },
  bannerText: {
    fontSize: typography.sizes.md,
    color: colors.white,
    marginBottom: spacing.md,
    fontWeight: typography.weights.medium,
  },
  createAccountButton: {
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: borderRadius.md,
  },
  createAccountButtonText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },

  // Divider
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginHorizontal: spacing.md,
  },
});

export default LoginScreen;
