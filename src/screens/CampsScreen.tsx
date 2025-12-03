/**
 * PTP Mobile App - Camps Screen
 *
 * React Query powered camps list with filtering, pull-to-refresh, and error handling.
 */

import React, { useMemo, useState, useCallback } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { useCampsWithFiltersQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import {
  Card,
  Badge,
  LoadingScreen,
  ErrorState,
  EmptyState,
  FilterBar,
} from '../components';
import { colors, spacing, typography } from '../theme';
import { Camp, CampsStackParamList, CampFilters } from '../types';

type Props = NativeStackScreenProps<CampsStackParamList, 'Camps'>;

const CampsScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();
  const [filters, setFilters] = useState<CampFilters>({
    category: 'all',
    state: 'all',
  });

  const {
    data: camps = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useCampsWithFiltersQuery(filters);

  const typedError = useMemo(() => {
    if (error && error instanceof Error) return error;
    return null;
  }, [error]);

  const errorMessage =
    typedError?.message || 'Failed to load camps. Please try again.';

  const handleCampPress = (camp: Camp) => {
    navigation.navigate('CampDetail', { camp });
  };

  const handleRefresh = () => {
    refetch();
  };

  const handleFiltersChange = useCallback((newFilters: CampFilters) => {
    setFilters(newFilters);
  }, []);

  // Sort camps locally if needed (server should handle this, but fallback)
  const sortedCamps = useMemo(() => {
    if (!filters.sortBy) return camps;

    return [...camps].sort((a, b) => {
      const order = filters.sortOrder === 'desc' ? -1 : 1;

      switch (filters.sortBy) {
        case 'date':
          return (
            order *
            (new Date(a.date).getTime() - new Date(b.date).getTime())
          );
        case 'price':
          const priceA = parseFloat(a.price.replace(/[^0-9.]/g, '')) || 0;
          const priceB = parseFloat(b.price.replace(/[^0-9.]/g, '')) || 0;
          return order * (priceA - priceB);
        case 'name':
          return order * a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });
  }, [camps, filters.sortBy, filters.sortOrder]);

  const renderCampCard = ({ item }: { item: Camp }) => (
    <Card style={styles.campCard} onPress={() => handleCampPress(item)}>
      {item.image ? (
        <Image
          source={{ uri: item.image }}
          style={styles.campImage}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.campImage, styles.campImagePlaceholder]}>
          <Text style={styles.campImagePlaceholderText}>PTP</Text>
        </View>
      )}

      <View style={styles.campInfo}>
        <View style={styles.badgeRow}>
          {item.category === 'winter-clinics' && (
            <Badge label="Winter Clinic" variant="info" style={styles.badge} />
          )}
          {item.bestseller && (
            <Badge
              label="Best Seller"
              variant="bestseller"
              style={styles.badge}
            />
          )}
          {(item.almost_full || item.isAlmostFull) && (
            <Badge
              label="Almost Full"
              variant="almostFull"
              style={styles.badge}
            />
          )}
          {item.isWaitlistOnly && (
            <Badge label="Waitlist" variant="warning" style={styles.badge} />
          )}
        </View>

        <Text style={styles.campName} numberOfLines={2}>
          {item.name}
        </Text>

        <View style={styles.detailsRow}>
          <Ionicons
            name="calendar-outline"
            size={14}
            color={colors.gray}
            style={styles.detailIcon}
          />
          <Text style={styles.detailText}>{item.date}</Text>
        </View>

        {item.time && (
          <View style={styles.detailsRow}>
            <Ionicons
              name="time-outline"
              size={14}
              color={colors.gray}
              style={styles.detailIcon}
            />
            <Text style={styles.detailText}>{item.time}</Text>
          </View>
        )}

        <View style={styles.detailsRow}>
          <Ionicons
            name="location-outline"
            size={14}
            color={colors.gray}
            style={styles.detailIcon}
          />
          <Text style={styles.detailText}>
            {item.location}
            {item.state ? `, ${item.state}` : ''}
          </Text>
        </View>

        {typeof item.availableSeats === 'number' && (
          <View style={styles.detailsRow}>
            <Ionicons
              name="ticket-outline"
              size={14}
              color={colors.gray}
              style={styles.detailIcon}
            />
            <Text style={styles.detailText}>
              {item.isWaitlistOnly
                ? 'Waitlist only'
                : `${item.availableSeats} spots left`}
            </Text>
          </View>
        )}

        <View style={styles.priceRow}>
          <Text style={styles.price}>{item.price}</Text>
          <Text style={styles.viewDetails}>View Details</Text>
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

  const hasActiveFilters =
    (filters.category && filters.category !== 'all') ||
    (filters.state && filters.state !== 'all');

  if (!isLoading && camps.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
        <EmptyState
          title={hasActiveFilters ? 'No Matching Camps' : 'No Camps Available'}
          message={
            hasActiveFilters
              ? 'Try adjusting your filters to see more camps.'
              : 'Check back soon for upcoming camps and clinics!'
          }
          iconName="football-outline"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FilterBar filters={filters} onFiltersChange={handleFiltersChange} />
      <FlatList
        data={sortedCamps}
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
        ListHeaderComponent={
          <Text style={styles.resultsCount}>
            {sortedCamps.length} {sortedCamps.length === 1 ? 'camp' : 'camps'}{' '}
            found
          </Text>
        }
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
  resultsCount: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.md,
  },
  campCard: {
    overflow: 'hidden',
    padding: 0,
  },
  campImage: {
    width: '100%',
    height: 160,
    backgroundColor: colors.border,
  },
  campImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  campImagePlaceholderText: {
    fontSize: 32,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
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
    marginBottom: spacing.md,
    lineHeight: typography.sizes.lg * typography.lineHeights.tight,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  detailIcon: {
    marginRight: spacing.sm,
    width: 20,
  },
  detailText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    flex: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  price: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  viewDetails: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.primary,
  },
});

export default CampsScreen;
