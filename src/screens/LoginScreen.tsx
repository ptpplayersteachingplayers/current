/**
 * PTP Mobile App - Login Screen
 *
 * Features:
 * - Hero background image with overlay
 * - Real PTP logo
 * - Email/username and password inputs
 * - Account creation (sign up) mode
 * - PTP branded styling
 * - Loading state during login/register
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
  Alert,
  ImageBackground,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import { LOGO, SCREEN_IMAGES } from '../constants/images';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type AuthMode = 'login' | 'register';

const LoginScreen: React.FC = () => {
  const { login, register, isLoading, continueAsGuest } = useAuth();

  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);
  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegisterMode = mode === 'register';

  const handleLogin = async () => {
    setError(null);

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
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    }
  };

  const handleRegister = async () => {
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedConfirmPassword = confirmPassword.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    if (!trimmedFirstName) {
      setError('Please enter your first name.');
      return;
    }

    if (!trimmedLastName) {
      setError('Please enter your last name.');
      return;
    }

    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (!trimmedPassword) {
      setError('Please enter a password.');
      return;
    }

    if (trimmedPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      await register({
        email: trimmedEmail,
        password: trimmedPassword,
        first_name: trimmedFirstName,
        last_name: trimmedLastName,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
    }
  };

  const handleSubmit = () => {
    if (isRegisterMode) {
      handleRegister();
    } else {
      handleLogin();
    }
  };

  const toggleMode = () => {
    setError(null);
    setMode(isRegisterMode ? 'login' : 'register');
  };

  const clearForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setFirstName('');
    setLastName('');
    setError(null);
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

      {/* Login/Register Form Card */}
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
            <Text style={styles.welcomeText}>
              {isRegisterMode ? 'Create Account' : 'Welcome Back'}
            </Text>
            <Text style={styles.instructionText}>
              {isRegisterMode
                ? 'Sign up to register for camps and book private training'
                : 'Sign in to view your camps and training schedule'}
            </Text>

            {/* Error Message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Name Fields (Register Mode Only) */}
            {isRegisterMode && (
              <View style={styles.nameRow}>
                <View style={[styles.inputGroup, styles.nameInput]}>
                  <Text style={styles.label}>First Name</Text>
                  <TextInput
                    style={[styles.input, firstNameFocused && styles.inputFocused]}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor={colors.grayLight}
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="givenName"
                    onFocus={() => setFirstNameFocused(true)}
                    onBlur={() => setFirstNameFocused(false)}
                    editable={!isLoading}
                  />
                </View>
                <View style={[styles.inputGroup, styles.nameInput]}>
                  <Text style={styles.label}>Last Name</Text>
                  <TextInput
                    style={[styles.input, lastNameFocused && styles.inputFocused]}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor={colors.grayLight}
                    autoCapitalize="words"
                    autoCorrect={false}
                    textContentType="familyName"
                    onFocus={() => setLastNameFocused(true)}
                    onBlur={() => setLastNameFocused(false)}
                    editable={!isLoading}
                  />
                </View>
              </View>
            )}

            {/* Email Input */}
            <View style={styles.inputGroup}>
              <Text style={styles.label}>
                {isRegisterMode ? 'Email Address' : 'Email or Username'}
              </Text>
              <TextInput
                style={[styles.input, emailFocused && styles.inputFocused]}
                value={email}
                onChangeText={setEmail}
                placeholder={isRegisterMode ? 'Enter your email' : 'Enter your email or username'}
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
                placeholder={isRegisterMode ? 'Create a password (min 8 characters)' : 'Enter your password'}
                placeholderTextColor={colors.grayLight}
                secureTextEntry
                textContentType={isRegisterMode ? 'newPassword' : 'password'}
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                editable={!isLoading}
                onSubmitEditing={isRegisterMode ? undefined : handleSubmit}
              />
            </View>

            {/* Confirm Password (Register Mode Only) */}
            {isRegisterMode && (
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <TextInput
                  style={[styles.input, confirmPasswordFocused && styles.inputFocused]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm your password"
                  placeholderTextColor={colors.grayLight}
                  secureTextEntry
                  textContentType="newPassword"
                  onFocus={() => setConfirmPasswordFocused(true)}
                  onBlur={() => setConfirmPasswordFocused(false)}
                  editable={!isLoading}
                  onSubmitEditing={handleSubmit}
                />
              </View>
            )}

            {/* Submit Button */}
            <PrimaryButton
              title={isRegisterMode ? 'Create Account' : 'Log In'}
              onPress={handleSubmit}
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

            {/* Forgot Password Link (Login Mode Only) */}
            {!isRegisterMode && (
              <TouchableOpacity
                style={styles.forgotPasswordButton}
                onPress={() => {
                  Alert.alert(
                    'Reset Password',
                    'Please visit ptpsummercamps.com to reset your password.',
                    [{ text: 'OK' }]
                  );
                }}
              >
                <Text style={styles.forgotPasswordText}>Forgot your password?</Text>
              </TouchableOpacity>
            )}

            {/* Footer - Toggle Mode */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                {isRegisterMode ? 'Already have an account? ' : "Don't have an account? "}
                <Text style={styles.footerLink} onPress={toggleMode}>
                  {isRegisterMode ? 'Log In' : 'Sign Up'}
                </Text>
              </Text>
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
    marginBottom: spacing.sm,
  },
  heroTitle: {
    fontSize: typography.sizes.lg,
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
    marginTop: -spacing.xl,
  },
  scrollContent: {
    flexGrow: 1,
  },
  formCard: {
    flex: 1,
    backgroundColor: colors.white,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
    minHeight: SCREEN_HEIGHT * 0.7,
  },

  // Form Content
  welcomeText: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
  },
  instructionText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.lg,
    lineHeight: typography.sizes.sm * typography.lineHeights.normal,
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

  // Name Row
  nameRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  nameInput: {
    flex: 1,
  },

  // Input
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    marginBottom: spacing.xs,
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
    marginTop: spacing.md,
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
    marginTop: spacing.lg,
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
    paddingTop: spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    textAlign: 'center',
  },
  footerLink: {
    color: colors.primary,
    fontWeight: typography.weights.semibold,
  },
});

export default LoginScreen;
