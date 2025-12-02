/**
 * PTP Mobile App - Camp Detail Screen
 *
 * Features:
 * - Full camp information display
 * - Hero image
 * - CTA to book (opens web checkout)
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
import { PrimaryButton, Badge } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { CampsStackParamList } from '../types';

type Props = NativeStackScreenProps<CampsStackParamList, 'CampDetail'>;

const CampDetailScreen: React.FC<Props> = ({ route }) => {
  const { camp } = route.params;

  const handleRegister = async () => {
    if (camp.product_url) {
      try {
        const supported = await Linking.canOpenURL(camp.product_url);
        if (supported) {
          await Linking.openURL(camp.product_url);
        } else {
          Alert.alert(
            'Unable to Open',
            'Please visit ptpsummercamps.com to register.'
          );
        }
      } catch {
        Alert.alert(
          'Error',
          'Unable to open registration page. Please visit ptpsummercamps.com.'
        );
      }
    } else {
      Alert.alert(
        'Register',
        'To register for this camp, please visit ptpsummercamps.com',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Visit Website',
            onPress: () => Linking.openURL('https://ptpsummercamps.com'),
          },
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Image */}
        {camp.image ? (
          <Image
            source={{ uri: camp.image }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.heroImage, styles.heroImagePlaceholder]}>
            <Text style={styles.heroPlaceholderText}>PTP</Text>
          </View>
        )}

        {/* Content */}
        <View style={styles.content}>
          {/* Badges */}
          <View style={styles.badgeRow}>
            {camp.bestseller && (
              <Badge label="Best Seller" variant="bestseller" style={styles.badge} />
            )}
            {camp.almost_full && (
              <Badge label="Almost Full" variant="almostFull" style={styles.badge} />
            )}
            {camp.category && (
              <Badge
                label={camp.category === 'winter-clinics' ? 'Winter Clinic' : 'Summer Camp'}
                variant="info"
                style={styles.badge}
              />
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>{camp.name}</Text>

          {/* Price */}
          <Text style={styles.price}>{camp.price}</Text>

          {/* Details Card */}
          <View style={styles.detailsCard}>
            <Text style={styles.detailsTitle}>Camp Details</Text>

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>{camp.date || 'TBD'}</Text>
            </View>

            {camp.time && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Time</Text>
                <Text style={styles.detailValue}>{camp.time}</Text>
              </View>
            )}

            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Location</Text>
              <Text style={styles.detailValue}>
                {camp.location}
                {camp.state ? `, ${camp.state}` : ''}
              </Text>
            </View>
          </View>

          {/* Description */}
          {camp.description && (
            <View style={styles.descriptionSection}>
              <Text style={styles.sectionTitle}>About This Camp</Text>
              <Text style={styles.description}>{camp.description}</Text>
            </View>
          )}

          {/* What's Included (placeholder content) */}
          <View style={styles.includesSection}>
            <Text style={styles.sectionTitle}>What's Included</Text>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>?</Text>
              <Text style={styles.includeText}>Professional coaching from NCAA & pro players</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>?</Text>
              <Text style={styles.includeText}>PTP camp t-shirt</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>?</Text>
              <Text style={styles.includeText}>Skills assessment and feedback</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>?</Text>
              <Text style={styles.includeText}>Fun, competitive environment</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Fixed Bottom CTA */}
      <View style={styles.bottomCta}>
        <View style={styles.bottomCtaContent}>
          <View>
            <Text style={styles.bottomPrice}>{camp.price}</Text>
            <Text style={styles.bottomPriceLabel}>per camper</Text>
          </View>
          <PrimaryButton
            title="Register Now"
            onPress={handleRegister}
            style={styles.registerButton}
          />
        </View>
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

  // Hero Image
  heroImage: {
    width: '100%',
    height: 220,
    backgroundColor: colors.border,
  },
  heroImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  heroPlaceholderText: {
    fontSize: 48,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },

  // Content
  content: {
    padding: spacing.xl,
    paddingBottom: 120, // Space for fixed CTA
  },

  // Badges
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.md,
  },
  badge: {
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },

  // Title & Price
  title: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
    lineHeight: typography.sizes.xxl * typography.lineHeights.tight,
  },
  price: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.primary,
    marginBottom: spacing.xl,
  },

  // Details Card
  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  detailsTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  detailValue: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.md,
  },

  // Description
  descriptionSection: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  description: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    lineHeight: typography.sizes.md * typography.lineHeights.relaxed,
  },

  // Includes
  includesSection: {
    marginBottom: spacing.xl,
  },
  includeItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  includeIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
    marginTop: 2,
  },
  includeText: {
    fontSize: typography.sizes.md,
    color: colors.ink,
    flex: 1,
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
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
  bottomPrice: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  bottomPriceLabel: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },
  registerButton: {
    minWidth: 160,
  },
});

export default CampDetailScreen;
