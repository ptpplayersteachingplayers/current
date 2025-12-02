/**
 * PTP Mobile App - Camps Screen
 *
 * Features:
 * - List of camps and clinics
 * - Loading, error, and empty states
 * - Pull to refresh
 * - Badges for bestseller/almost full
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { getCamps, ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Badge, LoadingScreen, ErrorState, EmptyState } from '../components';
import { colors, spacing, typography } from '../theme';
import { Camp, CampsStackParamList } from '../types';

type Props = NativeStackScreenProps<CampsStackParamList, 'Camps'>;

const CampsScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();

  const [camps, setCamps] = useState<Camp[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCamps = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await getCamps();
      setCamps(data);
    } catch (err) {
      if (err instanceof ApiClientError && err.isSessionExpired()) {
        await logout();
        return;
      }

      const message =
        err instanceof Error
          ? err.message
          : 'Failed to load camps. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [logout]);

  useEffect(() => {
    fetchCamps();
  }, [fetchCamps]);

  const handleCampPress = (camp: Camp) => {
    navigation.navigate('CampDetail', { camp });
  };

  const handleRefresh = () => {
    fetchCamps(true);
  };

  const renderCampCard = ({ item }: { item: Camp }) => (
    <Card
      style={styles.campCard}
      onPress={() => handleCampPress(item)}
    >
      {/* Camp Image */}
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

      {/* Camp Info */}
      <View style={styles.campInfo}>
        {/* Badges */}
        <View style={styles.badgeRow}>
          {item.bestseller && (
            <Badge label="Best Seller" variant="bestseller" style={styles.badge} />
          )}
          {item.almost_full && (
            <Badge label="Almost Full" variant="almostFull" style={styles.badge} />
          )}
        </View>

        {/* Name */}
        <Text style={styles.campName} numberOfLines={2}>
          {item.name}
        </Text>

        {/* Details */}
        <View style={styles.detailsRow}>
          <Text style={styles.detailIcon}>?</Text>
          <Text style={styles.detailText}>{item.date}</Text>
        </View>

        {item.time && (
          <View style={styles.detailsRow}>
            <Text style={styles.detailIcon}>?</Text>
            <Text style={styles.detailText}>{item.time}</Text>
          </View>
        )}

        <View style={styles.detailsRow}>
          <Text style={styles.detailIcon}>?</Text>
          <Text style={styles.detailText}>
            {item.location}
            {item.state ? `, ${item.state}` : ''}
          </Text>
        </View>

        {/* Price */}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{item.price}</Text>
          <Text style={styles.viewDetails}>View Details ?</Text>
        </View>
      </View>
    </Card>
  );

  // Loading state
  if (isLoading && !isRefreshing) {
    return <LoadingScreen message="Loading camps..." />;
  }

  // Error state
  if (error && camps.length === 0) {
    return (
      <ErrorState
        message={error}
        onRetry={() => fetchCamps()}
      />
    );
  }

  // Empty state
  if (!isLoading && camps.length === 0) {
    return (
      <EmptyState
        title="No Camps Available"
        message="Check back soon for upcoming camps and clinics!"
        icon="?"
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
            refreshing={isRefreshing}
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

  // Camp Card
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

  // Badges
  badgeRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  badge: {
    marginRight: spacing.sm,
  },

  // Camp Name
  campName: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.md,
    lineHeight: typography.sizes.lg * typography.lineHeights.tight,
  },

  // Details
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  detailIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
    width: 20,
    textAlign: 'center',
  },
  detailText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    flex: 1,
  },

  // Price Row
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
