/**
 * PTP Mobile App - Camp Detail Screen
 *
 * Features:
 * - Full camp information display
 * - Hero image
 * - CTA to book (opens web checkout)
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PrimaryButton, Badge } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { CampsStackParamList } from '../types';
import { addToCart } from '../api/client';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<CampsStackParamList, 'CampDetail'>;

const CampDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { camp } = route.params;
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(1);

  const addToCartMutation = useMutation({
    mutationFn: () => addToCart({ productId: camp.id, quantity }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      Alert.alert(
        'Added to Cart',
        `${camp.name} has been added to your cart.`,
        [
          { text: 'Continue Shopping', style: 'cancel' },
          {
            text: 'View Cart',
            onPress: () => navigation.navigate('Cart'),
          },
        ]
      );
    },
    onError: (error) => {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Failed to add to cart'
      );
    },
  });

  const handleAddToCart = () => {
    if (isGuest || !user) {
      Alert.alert(
        'Sign In Required',
        'Please sign in to add items to your cart.',
        [{ text: 'OK' }]
      );
      return;
    }
    addToCartMutation.mutate();
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
              <Text style={styles.includeIcon}>⚽</Text>
              <Text style={styles.includeText}>Professional coaching from NCAA & pro players</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>👕</Text>
              <Text style={styles.includeText}>PTP camp t-shirt</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>📊</Text>
              <Text style={styles.includeText}>Skills assessment and feedback</Text>
            </View>
            <View style={styles.includeItem}>
              <Text style={styles.includeIcon}>🏆</Text>
              <Text style={styles.includeText}>Fun, competitive environment</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Fixed Bottom CTA */}
      <View style={styles.bottomCta}>
        {/* Quantity Selector */}
        <View style={styles.quantityRow}>
          <Text style={styles.quantityLabel}>Campers:</Text>
          <View style={styles.quantityControls}>
            <TouchableOpacity
              style={[styles.quantityButton, quantity <= 1 && styles.quantityButtonDisabled]}
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
            >
              <Text style={styles.quantityButtonText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.quantityValue}>{quantity}</Text>
            <TouchableOpacity
              style={styles.quantityButton}
              onPress={() => setQuantity((q) => q + 1)}
            >
              <Text style={styles.quantityButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.bottomCtaContent}>
          <View>
            <Text style={styles.bottomPrice}>{camp.price}</Text>
            <Text style={styles.bottomPriceLabel}>per camper</Text>
          </View>
          <PrimaryButton
            title="Add to Cart"
            onPress={handleAddToCart}
            loading={addToCartMutation.isPending}
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
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  quantityLabel: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  quantityButtonDisabled: {
    opacity: 0.5,
  },
  quantityButtonText: {
    fontSize: 20,
    color: colors.ink,
    fontWeight: typography.weights.medium,
  },
  quantityValue: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginHorizontal: spacing.lg,
    minWidth: 24,
    textAlign: 'center',
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
    minWidth: 140,
  },
});

export default CampDetailScreen;
