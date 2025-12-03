/**
 * PTP Mobile App - Child Profile Form Screen
 *
 * Used for both adding new children and editing existing profiles.
 * Handles form validation and API mutations.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  useCreateChildProfileMutation,
  useUpdateChildProfileMutation,
} from '../api/queries';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import {
  ChildProfile,
  ProfileStackParamList,
  ExperienceLevel,
  TShirtSize,
  CreateChildProfileRequest,
} from '../types';

type AddProps = NativeStackScreenProps<ProfileStackParamList, 'AddChildProfile'>;
type EditProps = NativeStackScreenProps<ProfileStackParamList, 'EditChildProfile'>;
type Props = AddProps | EditProps;

const EXPERIENCE_LEVELS: { value: ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'competitive', label: 'Competitive' },
];

const TSHIRT_SIZES: { value: TShirtSize; label: string }[] = [
  { value: 'YXS', label: 'Youth XS' },
  { value: 'YS', label: 'Youth S' },
  { value: 'YM', label: 'Youth M' },
  { value: 'YL', label: 'Youth L' },
  { value: 'YXL', label: 'Youth XL' },
  { value: 'AS', label: 'Adult S' },
  { value: 'AM', label: 'Adult M' },
  { value: 'AL', label: 'Adult L' },
  { value: 'AXL', label: 'Adult XL' },
];

const POSITIONS = [
  'Goalkeeper',
  'Defender',
  'Midfielder',
  'Forward',
  'Any Position',
];

const ChildProfileFormScreen: React.FC<Props> = ({ route, navigation }) => {
  const isEditing = route.name === 'EditChildProfile';
  const existingChild = isEditing
    ? (route as EditProps).params.child
    : undefined;

  const createMutation = useCreateChildProfileMutation();
  const updateMutation = useUpdateChildProfileMutation();

  const [name, setName] = useState(existingChild?.name ?? '');
  const [birthDate, setBirthDate] = useState(existingChild?.birth_date ?? '');
  const [gender, setGender] = useState<ChildProfile['gender']>(
    existingChild?.gender
  );
  const [experienceLevel, setExperienceLevel] = useState<
    ExperienceLevel | undefined
  >(existingChild?.experience_level);
  const [team, setTeam] = useState(existingChild?.team ?? '');
  const [position, setPosition] = useState(existingChild?.position ?? '');
  const [tshirtSize, setTshirtSize] = useState<TShirtSize | undefined>(
    existingChild?.tshirt_size
  );
  const [notes, setNotes] = useState(existingChild?.notes ?? '');
  const [medicalNotes, setMedicalNotes] = useState(
    existingChild?.medical_notes ?? ''
  );

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoading = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    navigation.setOptions({
      title: isEditing ? 'Edit Child' : 'Add Child',
    });
  }, [navigation, isEditing]);

  const validateForm = (): boolean => {
    if (!name.trim()) {
      setError('Please enter your child\'s name.');
      return false;
    }
    if (birthDate && !isValidDate(birthDate)) {
      setError('Please enter a valid birth date (YYYY-MM-DD).');
      return false;
    }
    return true;
  };

  const isValidDate = (dateString: string): boolean => {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) return false;
    const date = new Date(dateString);
    return !isNaN(date.getTime());
  };

  const handleSubmit = async () => {
    setError(null);

    if (!validateForm()) return;

    const profileData: CreateChildProfileRequest = {
      name: name.trim(),
      birth_date: birthDate || undefined,
      gender: gender,
      experience_level: experienceLevel,
      team: team.trim() || undefined,
      position: position || undefined,
      tshirt_size: tshirtSize,
      notes: notes.trim() || undefined,
      medical_notes: medicalNotes.trim() || undefined,
    };

    try {
      if (isEditing && existingChild) {
        await updateMutation.mutateAsync({
          id: existingChild.id,
          ...profileData,
        });
        Alert.alert('Success', 'Profile updated successfully.');
      } else {
        await createMutation.mutateAsync(profileData);
        Alert.alert('Success', 'Child profile added successfully.');
      }
      navigation.goBack();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An error occurred. Please try again.';
      setError(message);
    }
  };

  const renderSelectOption = <T extends string>(
    options: { value: T; label: string }[],
    selected: T | undefined,
    onSelect: (value: T | undefined) => void,
    placeholder: string
  ) => (
    <View style={styles.selectContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectOptions}
      >
        {options.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.selectOption,
              selected === option.value && styles.selectOptionSelected,
            ]}
            onPress={() =>
              onSelect(selected === option.value ? undefined : option.value)
            }
          >
            <Text
              style={[
                styles.selectOptionText,
                selected === option.value && styles.selectOptionTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Error Message */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Name *</Text>
            <TextInput
              style={[
                styles.input,
                focusedField === 'name' && styles.inputFocused,
              ]}
              value={name}
              onChangeText={setName}
              placeholder="Child's full name"
              placeholderTextColor={colors.grayLight}
              autoCapitalize="words"
              autoCorrect={false}
              onFocus={() => setFocusedField('name')}
              onBlur={() => setFocusedField(null)}
              editable={!isLoading}
            />
          </View>

          {/* Birth Date */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Birth Date</Text>
            <TextInput
              style={[
                styles.input,
                focusedField === 'birthDate' && styles.inputFocused,
              ]}
              value={birthDate}
              onChangeText={setBirthDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.grayLight}
              keyboardType="numbers-and-punctuation"
              onFocus={() => setFocusedField('birthDate')}
              onBlur={() => setFocusedField(null)}
              editable={!isLoading}
            />
            <Text style={styles.hint}>Format: 2015-06-15</Text>
          </View>

          {/* Gender */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Gender</Text>
            <View style={styles.selectContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectOptions}
              >
                {[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                  { value: 'other', label: 'Other' },
                  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
                ].map((option) => (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.selectOption,
                      gender === option.value && styles.selectOptionSelected,
                    ]}
                    onPress={() =>
                      setGender(
                        gender === option.value
                          ? undefined
                          : (option.value as ChildProfile['gender'])
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.selectOptionText,
                        gender === option.value &&
                          styles.selectOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Experience Level */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Experience Level</Text>
            {renderSelectOption(
              EXPERIENCE_LEVELS,
              experienceLevel,
              setExperienceLevel,
              'Select experience level'
            )}
          </View>

          {/* Team */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Team / Club</Text>
            <TextInput
              style={[
                styles.input,
                focusedField === 'team' && styles.inputFocused,
              ]}
              value={team}
              onChangeText={setTeam}
              placeholder="e.g., FC United U12"
              placeholderTextColor={colors.grayLight}
              autoCapitalize="words"
              onFocus={() => setFocusedField('team')}
              onBlur={() => setFocusedField(null)}
              editable={!isLoading}
            />
          </View>

          {/* Position */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Preferred Position</Text>
            <View style={styles.selectContainer}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectOptions}
              >
                {POSITIONS.map((pos) => (
                  <TouchableOpacity
                    key={pos}
                    style={[
                      styles.selectOption,
                      position === pos && styles.selectOptionSelected,
                    ]}
                    onPress={() =>
                      setPosition(position === pos ? '' : pos)
                    }
                  >
                    <Text
                      style={[
                        styles.selectOptionText,
                        position === pos && styles.selectOptionTextSelected,
                      ]}
                    >
                      {pos}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* T-Shirt Size */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>T-Shirt Size</Text>
            {renderSelectOption(
              TSHIRT_SIZES,
              tshirtSize,
              setTshirtSize,
              'Select t-shirt size'
            )}
          </View>

          {/* Notes */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                focusedField === 'notes' && styles.inputFocused,
              ]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes about your child..."
              placeholderTextColor={colors.grayLight}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              onFocus={() => setFocusedField('notes')}
              onBlur={() => setFocusedField(null)}
              editable={!isLoading}
            />
          </View>

          {/* Medical Notes */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Medical Notes / Allergies</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                focusedField === 'medical' && styles.inputFocused,
              ]}
              value={medicalNotes}
              onChangeText={setMedicalNotes}
              placeholder="Any medical conditions, allergies, or special needs..."
              placeholderTextColor={colors.grayLight}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              onFocus={() => setFocusedField('medical')}
              onBlur={() => setFocusedField(null)}
              editable={!isLoading}
            />
            <View style={styles.medicalNote}>
              <Ionicons
                name="shield-checkmark-outline"
                size={14}
                color={colors.gray}
              />
              <Text style={styles.medicalNoteText}>
                This information is kept private and only shared with coaches
                when necessary.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Submit Button */}
        <View style={styles.submitContainer}>
          <PrimaryButton
            title={isEditing ? 'Save Changes' : 'Add Child'}
            onPress={handleSubmit}
            loading={isLoading}
            disabled={isLoading}
          />
        </View>
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
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
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

  // Input Group
  inputGroup: {
    marginBottom: spacing.lg,
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
  textArea: {
    minHeight: 80,
    paddingTop: spacing.md,
  },
  hint: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginTop: spacing.xs,
  },

  // Select Options
  selectContainer: {
    marginTop: spacing.xs,
  },
  selectOptions: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
  },
  selectOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    marginRight: spacing.sm,
  },
  selectOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  selectOptionText: {
    fontSize: typography.sizes.sm,
    color: colors.ink,
  },
  selectOptionTextSelected: {
    color: colors.ink,
    fontWeight: typography.weights.semibold,
  },

  // Medical Note
  medicalNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  medicalNoteText: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginLeft: spacing.xs,
    flex: 1,
    lineHeight: typography.sizes.xs * typography.lineHeights.normal,
  },

  // Submit
  submitContainer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
  },
});

export default ChildProfileFormScreen;
