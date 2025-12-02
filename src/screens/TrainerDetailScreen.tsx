/**
 * PTP Mobile App - Trainer Detail Screen
 *
 * Features:
 * - Full trainer profile
 * - Bio and credentials
 * - Contact CTA
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Linking,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { TrainingStackParamList } from '../types';
import { useAuth } from '../context/AuthContext';
import { ensureTrainerConversation } from '../api/chat';

type Props = NativeStackScreenProps<TrainingStackParamList, 'TrainerDetail'>;

const TrainerDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { trainer } = route.params;
  const { user } = useAuth();

  const handleContact = () => {
    Alert.alert(
      'Contact PTP',
      'To book a session with this trainer, please contact PTP.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Email PTP',
          onPress: () => Linking.openURL('mailto:info@ptpsummercamps.com?subject=Private Training Inquiry'),
        },
        {
          text: 'Visit Website',
          onPress: () => Linking.openURL('https://ptpsummercamps.com/private-training'),
        },
      ]
    );
  };

  const handleMessageTrainer = async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Please sign in to message your trainer.');
      return;
    }

    const conversation = await ensureTrainerConversation(
      String(user.id),
      String(trainer.id),
      undefined,
      trainer.name
    );

    navigation.getParent()?.navigate('MessagesTab' as never, {
      screen: 'Chat',
      params: { conversationId: conversation.id, title: trainer.name },
    } as never);
  };

  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return (
      <Text style={styles.stars}>
        {'★'.repeat(fullStars)}
        {hasHalfStar ? '☆' : ''}
        {'☆'.repeat(emptyStars)}
      </Text>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {/* Photo */}
          {trainer.photo ? (
            <Image
              source={{ uri: trainer.photo }}
              style={styles.profilePhoto}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.profilePhoto, styles.photoPlaceholder]}>
              <Text style={styles.photoPlaceholderText}>
                {trainer.name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          {/* Name & College */}
          <Text style={styles.trainerName}>{trainer.name}</Text>

          {trainer.college && (
            <View style={styles.collegeRow}>
              <Text style={styles.collegeIcon}>?</Text>
              <Text style={styles.collegeText}>{trainer.college}</Text>
            </View>
          )}

          {/* Rating */}
          {trainer.rating > 0 && (
            <View style={styles.ratingContainer}>
              {renderStars(trainer.rating)}
              <Text style={styles.ratingText}>
                {trainer.rating.toFixed(1)} rating
              </Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Quick Info */}
          <View style={styles.infoCard}>
            {trainer.city && (
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>?</Text>
                <View>
                  <Text style={styles.infoLabel}>Location</Text>
                  <Text style={styles.infoValue}>{trainer.city}</Text>
                </View>
              </View>
            )}

            {trainer.specialty && (
              <View style={styles.infoRow}>
                <Text style={styles.infoIcon}>?</Text>
                <View>
                  <Text style={styles.infoLabel}>Specialty</Text>
                  <Text style={styles.infoValue}>{trainer.specialty}</Text>
                </View>
              </View>
            )}
          </View>

          {/* Bio */}
          {trainer.bio && (
            <View style={styles.bioSection}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.bioText}>{trainer.bio}</Text>
            </View>
          )}

          {/* What to Expect */}
          <View style={styles.expectSection}>
            <Text style={styles.sectionTitle}>What to Expect</Text>

            <View style={styles.expectItem}>
              <Text style={styles.expectIcon}>?</Text>
              <View style={styles.expectContent}>
                <Text style={styles.expectTitle}>Personalized Training</Text>
                <Text style={styles.expectText}>
                  Sessions tailored to your child's skill level and goals
                </Text>
              </View>
            </View>

            <View style={styles.expectItem}>
              <Text style={styles.expectIcon}>?</Text>
              <View style={styles.expectContent}>
                <Text style={styles.expectTitle}>Flexible Scheduling</Text>
                <Text style={styles.expectText}>
                  Work with the trainer to find times that fit your schedule
                </Text>
              </View>
            </View>

            <View style={styles.expectItem}>
              <Text style={styles.expectIcon}>?</Text>
              <View style={styles.expectContent}>
                <Text style={styles.expectTitle}>Progress Tracking</Text>
                <Text style={styles.expectText}>
                  Regular feedback on development and areas for improvement
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Fixed Bottom CTA */}
      <View style={styles.bottomCta}>
        <View style={styles.bottomCtaContent}>
          <View>
            <Text style={styles.bottomTitle}>Interested?</Text>
            <Text style={styles.bottomSubtitle}>Contact PTP to book</Text>
          </View>
          <PrimaryButton
            title="Message this Trainer"
            onPress={handleMessageTrainer}
            style={styles.contactButton}
          />
        </View>
        <PrimaryButton
          title="Contact PTP"
          onPress={handleContact}
          variant="outline"
          style={styles.secondaryCta}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  scrollView: {
    flex: 1,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profilePhoto: {
    width: 120,
    height: 120,
    borderRadius: borderRadius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.lg,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  photoPlaceholderText: {
    fontSize: 48,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  trainerName: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  collegeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  collegeIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  collegeText: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  stars: {
    fontSize: 18,
    letterSpacing: 2,
  },
  ratingText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginLeft: spacing.sm,
  },

  // Content
  content: {
    padding: spacing.xl,
    paddingBottom: 120,
  },

  // Info Card
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  infoIcon: {
    fontSize: 20,
    marginRight: spacing.md,
    marginTop: 2,
  },
  infoLabel: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.medium,
    color: colors.ink,
  },

  // Bio
  bioSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  bioText: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    lineHeight: typography.sizes.md * typography.lineHeights.relaxed,
  },

  // What to Expect
  expectSection: {
    marginBottom: spacing.xl,
  },
  expectItem: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  expectIcon: {
    fontSize: 24,
    marginRight: spacing.md,
    marginTop: 2,
  },
  expectContent: {
    flex: 1,
  },
  expectTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  expectText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    lineHeight: typography.sizes.sm * typography.lineHeights.normal,
  },

  // Bottom CTA
  bottomCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xl,
  },
  bottomCtaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  bottomSubtitle: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },
  contactButton: {
    minWidth: 140,
  },
  secondaryCta: {
    marginTop: spacing.sm,
  },
});

export default TrainerDetailScreen;
