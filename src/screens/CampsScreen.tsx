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

        <Text style={styles.campName} numberOfLines={2}>
          {item.name}
        </Text>

        <View style={styles.detailsRow}>
          <Text style={styles.detailIcon}>📅</Text>
          <Text style={styles.detailText}>{item.date}</Text>
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
            <Text style={styles.detailText}>
              {item.isWaitlistOnly
                ? 'Waitlist only'
                : `${item.availableSeats} spots left`}
            </Text>
          </View>
        )}

        <View style={styles.priceRow}>
          <Text style={styles.price}>{item.price}</Text>
          <Text style={styles.viewDetails}>View Details ›</Text>
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
    marginBottom: spacing.sm,
  },
  badge: {
    marginRight: spacing.sm,
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
