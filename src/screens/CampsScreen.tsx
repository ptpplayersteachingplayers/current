/**
 * PTP Mobile App - Camps Screen
 *
 * React Query powered camps list with pull-to-refresh and error handling.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  RefreshControl,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCampsQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, LoadingScreen, ErrorState, EmptyState } from '../components';
import { colors, spacing, typography } from '../theme';
import { Camp, CampsStackParamList } from '../types';

type Props = NativeStackScreenProps<CampsStackParamList, 'Camps'>;

const CampsScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();

  const {
    data: camps = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useCampsQuery();

  const typedError = useMemo(() => {
    if (error && error instanceof Error) return error;
    return null;
  }, [error]);

  const errorMessage = typedError?.message || 'Failed to load camps. Please try again.';

  const handleCampPress = (camp: Camp) => {
    navigation.navigate('CampDetail', { camp });
  };

  const handleRefresh = () => {
    refetch();
  };

  const renderCampCard = ({ item }: { item: Camp }) => (
    <Card style={styles.campCard} onPress={() => handleCampPress(item)}>
      {/* Image Section */}
      <View style={styles.imageContainer}>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={styles.campImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.campImage, styles.campImagePlaceholder]}>
            <Text style={styles.campImagePlaceholderText}>⚽</Text>
            <Text style={styles.campImagePlaceholderLabel}>PTP Soccer</Text>
          </View>
        )}
        {/* Price Badge Overlay */}
        <View style={styles.priceOverlay}>
          <Text style={styles.priceOverlayText}>{item.price}</Text>
        </View>
        {/* Category Badge */}
        {item.category && (
          <View style={styles.categoryBadge}>
            <Text style={styles.categoryBadgeText}>
              {item.category === 'winter-clinics' ? 'Winter Clinic' : 'Summer Camp'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.campInfo}>
        {/* Status Badges */}
        {(item.bestseller || item.almost_full || item.isAlmostFull || item.isWaitlistOnly) && (
          <View style={styles.badgeRow}>
            {item.bestseller && (
              <Badge label="Best Seller" variant="bestseller" style={styles.badge} />
            )}
            {(item.almost_full || item.isAlmostFull) && (
              <Badge label="Almost Full" variant="almostFull" style={styles.badge} />
            )}
            {item.isWaitlistOnly && (
              <Badge label="Waitlist" variant="warning" style={styles.badge} />
            )}
          </View>
        )}

        {/* Camp Name */}
        <Text style={styles.campName} numberOfLines={2}>
          {item.name}
        </Text>

        {/* Description Preview */}
        {item.description && (
          <Text style={styles.campDescription} numberOfLines={2}>
            {item.description.replace(/<[^>]*>/g, '')}
          </Text>
        )}

        {/* Details Grid */}
        <View style={styles.detailsContainer}>
          <View style={styles.detailsRow}>
            <Text style={styles.detailIcon}>📅</Text>
            <Text style={styles.detailText}>{item.date || 'Date TBD'}</Text>
          </View>

          {item.time && (
            <View style={styles.detailsRow}>
              <Text style={styles.detailIcon}>⏰</Text>
              <Text style={styles.detailText}>{item.time}</Text>
            </View>
          )}

          <View style={styles.detailsRow}>
            <Text style={styles.detailIcon}>📍</Text>
            <Text style={styles.detailText}>
              {item.location}
              {item.state ? `, ${item.state}` : ''}
            </Text>
          </View>

          {typeof item.availableSeats === 'number' && (
            <View style={styles.detailsRow}>
              <Text style={styles.detailIcon}>🎟️</Text>
              <Text style={[
                styles.detailText,
                item.isWaitlistOnly && styles.detailTextWarning,
                item.availableSeats <= 5 && !item.isWaitlistOnly && styles.detailTextUrgent
              ]}>
                {item.isWaitlistOnly
                  ? 'Waitlist only'
                  : item.availableSeats <= 5
                    ? `Only ${item.availableSeats} spots left!`
                    : `${item.availableSeats} spots available`}
              </Text>
            </View>
          )}
        </View>

        {/* CTA Row */}
        <View style={styles.ctaRow}>
          <View style={styles.priceContainer}>
            <Text style={styles.priceLabel}>Starting at</Text>
            <Text style={styles.price}>{item.price}</Text>
          </View>
          <View style={styles.viewDetailsButton}>
            <Text style={styles.viewDetailsText}>View Details</Text>
          </View>
        </View>
      </View>
    </Card>
  );

  if (isLoading && !isRefetching) {
    return <LoadingScreen message="Loading camps..." />;
  }

  if (isError && camps.length === 0) {
    if ((typedError as any)?.isSessionExpired?.()) {
      logout();
    }
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />;
  }

  if (!isLoading && camps.length === 0) {
    return (
      <EmptyState
        title="No Camps Available"
        message="Check back soon for upcoming camps and clinics!"
        icon="⚽"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={camps}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderCampCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  listContent: {
    padding: spacing.lg,
  },
  separator: {
    height: spacing.lg,
  },

  // Card Container
  campCard: {
    overflow: 'hidden',
    padding: 0,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },

  // Image Section
  imageContainer: {
    position: 'relative',
  },
  campImage: {
    width: '100%',
    height: 180,
    backgroundColor: colors.border,
  },
  campImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  campImagePlaceholderText: {
    fontSize: 48,
    marginBottom: spacing.xs,
  },
  campImagePlaceholderLabel: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
  priceOverlay: {
    position: 'absolute',
    bottom: spacing.md,
    right: spacing.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  priceOverlayText: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.white,
  },
  categoryBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    backgroundColor: 'rgba(14, 15, 17, 0.8)',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.semibold,
    color: colors.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Camp Info Section
  campInfo: {
    padding: spacing.lg,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  badge: {
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  campName: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
    lineHeight: typography.sizes.lg * typography.lineHeights.tight,
  },
  campDescription: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    lineHeight: typography.sizes.sm * typography.lineHeights.relaxed,
    marginBottom: spacing.md,
  },

  // Details Section
  detailsContainer: {
    backgroundColor: colors.offWhite,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  detailIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
    width: 22,
    textAlign: 'center',
  },
  detailText: {
    fontSize: typography.sizes.sm,
    color: colors.ink,
    flex: 1,
  },
  detailTextWarning: {
    color: '#F59E0B',
    fontWeight: typography.weights.medium,
  },
  detailTextUrgent: {
    color: colors.error,
    fontWeight: typography.weights.semibold,
  },

  // CTA Row
  ctaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceContainer: {
    flex: 1,
  },
  priceLabel: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginBottom: 2,
  },
  price: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  viewDetailsButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
  },
  viewDetailsText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.white,
  },
});

export default CampsScreen;
