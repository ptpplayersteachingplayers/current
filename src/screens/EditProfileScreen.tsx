/**
 * PTP Mobile App - Edit Profile Screen
 *
 * Features:
 * - Edit name and email
 * - Change password
 * - Save changes
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth } from '../context/AuthContext';
import { PrimaryButton, Card } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import { ProfileStackParamList } from '../types';
import { updateProfile, changePassword } from '../api/client';

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditProfile'>;

const EditProfileScreen: React.FC<Props> = ({ navigation }) => {
  const { user, refreshUser } = useAuth();

  // Profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');

  // Password fields
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI State
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      const nameParts = user.name.split(' ');
      setFirstName(nameParts[0] || '');
      setLastName(nameParts.slice(1).join(' ') || '');
      setEmail(user.email);
    }
  }, [user]);

  const validateEmail = (emailStr: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailStr);
  };

  const validatePassword = (pass: string): string[] => {
    const errors: string[] = [];
    if (pass.length < 8) errors.push('At least 8 characters');
    if (!/[A-Z]/.test(pass)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(pass)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(pass)) errors.push('One number');
    return errors;
  };

  const handleUpdateProfile = async () => {
    setProfileError(null);
    setProfileSuccess(false);

    if (!firstName.trim()) {
      setProfileError('First name is required');
      return;
    }

    if (!lastName.trim()) {
      setProfileError('Last name is required');
      return;
    }

    if (!email.trim() || !validateEmail(email.trim())) {
      setProfileError('Please enter a valid email address');
      return;
    }

    setIsUpdatingProfile(true);

    try {
      await updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
      });
      await refreshUser();
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to update profile';
      setProfileError(errorMessage);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordError(null);
    setPasswordSuccess(false);

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      return;
    }

    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      setPasswordError('New password must have: ' + passwordErrors.join(', '));
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsChangingPassword(true);

    try {
      await changePassword({
        currentPassword,
        newPassword,
      });
      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(false), 3000);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to change password';
      setPasswordError(errorMessage);
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Profile Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile Information</Text>
            <Card style={styles.card}>
              {profileError && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{profileError}</Text>
                </View>
              )}

              {profileSuccess && (
                <View style={styles.successContainer}>
                  <Text style={styles.successText}>Profile updated successfully!</Text>
                </View>
              )}

              <View style={styles.nameRow}>
                <View style={[styles.inputGroup, styles.nameInput]}>
                  <Text style={styles.label}>First Name</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'firstName' && styles.inputFocused,
                    ]}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor={colors.grayLight}
                    autoCapitalize="words"
                    onFocus={() => setFocusedField('firstName')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>

                <View style={[styles.inputGroup, styles.nameInput]}>
                  <Text style={styles.label}>Last Name</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'lastName' && styles.inputFocused,
                    ]}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor={colors.grayLight}
                    autoCapitalize="words"
                    onFocus={() => setFocusedField('lastName')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'email' && styles.inputFocused,
                  ]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="your@email.com"
                  placeholderTextColor={colors.grayLight}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <PrimaryButton
                title="Save Changes"
                onPress={handleUpdateProfile}
                loading={isUpdatingProfile}
                disabled={isUpdatingProfile}
              />
            </Card>
          </View>

          {/* Password Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Change Password</Text>
            <Card style={styles.card}>
              {passwordError && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{passwordError}</Text>
                </View>
              )}

              {passwordSuccess && (
                <View style={styles.successContainer}>
                  <Text style={styles.successText}>Password changed successfully!</Text>
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Current Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'currentPassword' && styles.inputFocused,
                  ]}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Enter current password"
                  placeholderTextColor={colors.grayLight}
                  secureTextEntry
                  onFocus={() => setFocusedField('currentPassword')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>New Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'newPassword' && styles.inputFocused,
                  ]}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Enter new password"
                  placeholderTextColor={colors.grayLight}
                  secureTextEntry
                  onFocus={() => setFocusedField('newPassword')}
                  onBlur={() => setFocusedField(null)}
                />
                {newPassword.length > 0 && (
                  <View style={styles.passwordHints}>
                    {['8+ characters', 'Uppercase', 'Lowercase', 'Number'].map(
                      (hint, index) => {
                        const checks = [
                          newPassword.length >= 8,
                          /[A-Z]/.test(newPassword),
                          /[a-z]/.test(newPassword),
                          /[0-9]/.test(newPassword),
                        ];
                        return (
                          <View key={hint} style={styles.hintRow}>
                            <Text
                              style={[
                                styles.hintIcon,
                                checks[index] && styles.hintIconSuccess,
                              ]}
                            >
                              {checks[index] ? '✓' : '○'}
                            </Text>
                            <Text
                              style={[
                                styles.hintText,
                                checks[index] && styles.hintTextSuccess,
                              ]}
                            >
                              {hint}
                            </Text>
                          </View>
                        );
                      }
                    )}
                  </View>
                )}
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Confirm New Password</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'confirmPassword' && styles.inputFocused,
                  ]}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Confirm new password"
                  placeholderTextColor={colors.grayLight}
                  secureTextEntry
                  onFocus={() => setFocusedField('confirmPassword')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <PrimaryButton
                title="Change Password"
                onPress={handleChangePassword}
                loading={isChangingPassword}
                disabled={isChangingPassword}
                variant="secondary"
              />
            </Card>
          </View>

          {/* Danger Zone */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Account</Text>
            <Card style={styles.card}>
              <TouchableOpacity
                style={styles.dangerButton}
                onPress={() => {
                  Alert.alert(
                    'Delete Account',
                    'To delete your account, please contact support at info@ptpsummercamps.com',
                    [{ text: 'OK' }]
                  );
                }}
              >
                <Text style={styles.dangerButtonText}>Delete Account</Text>
              </TouchableOpacity>
            </Card>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },

  // Section
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },

  // Card
  card: {
    padding: spacing.lg,
  },

  // Error/Success
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
  successContainer: {
    backgroundColor: '#D1FAE5',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  successText: {
    color: colors.success,
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

  // Password Hints
  passwordHints: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hintIcon: {
    fontSize: 12,
    color: colors.grayLight,
    marginRight: spacing.xs,
  },
  hintIconSuccess: {
    color: colors.success,
  },
  hintText: {
    fontSize: typography.sizes.xs,
    color: colors.grayLight,
  },
  hintTextSuccess: {
    color: colors.success,
  },

  // Danger Zone
  dangerButton: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  dangerButtonText: {
    fontSize: typography.sizes.md,
    color: colors.error,
    fontWeight: typography.weights.medium,
  },
});

export default EditProfileScreen;
