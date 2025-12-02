/**
 * PTP Mobile App - Trainers Screen
 *
 * Features:
 * - List of private trainers
 * - Trainer cards with photo, college, specialty
 * - Loading, error, and empty states
 * - Pull to refresh
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
import { getTrainers, ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, LoadingScreen, ErrorState, EmptyState } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { Trainer, TrainingStackParamList } from '../types';

type Props = NativeStackScreenProps<TrainingStackParamList, 'Trainers'>;

const TrainersScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();

  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTrainers = useCallback(async (showRefresh = false) => {
    if (showRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await getTrainers();
      setTrainers(data);
    } catch (err) {
      if (err instanceof ApiClientError && err.isSessionExpired()) {
        await logout();
        return;
      }

      const message =
        err instanceof Error
          ? err.message
          : 'Failed to load trainers. Please try again.';
      setError(message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [logout]);

  useEffect(() => {
    fetchTrainers();
  }, [fetchTrainers]);

  const handleTrainerPress = (trainer: Trainer) => {
    navigation.navigate('TrainerDetail', { trainer });
  };

  const handleRefresh = () => {
    fetchTrainers(true);
  };

  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return (
      <Text style={styles.stars}>
        {'?'.repeat(fullStars)}
        {hasHalfStar ? '?' : ''}
        {'?'.repeat(emptyStars)}
      </Text>
    );
  };

  const renderTrainerCard = ({ item }: { item: Trainer }) => (
    <Card
      style={styles.trainerCard}
      onPress={() => handleTrainerPress(item)}
    >
      <View style={styles.cardContent}>
        {/* Trainer Photo */}
        {item.photo ? (
          <Image
            source={{ uri: item.photo }}
            style={styles.trainerPhoto}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.trainerPhoto, styles.photoPlaceholder]}>
            <Text style={styles.photoPlaceholderText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        {/* Trainer Info */}
        <View style={styles.trainerInfo}>
          <Text style={styles.trainerName} numberOfLines={1}>
            {item.name}
          </Text>

          {item.college && (
            <Text style={styles.collegeText} numberOfLines={1}>
              {item.college}
            </Text>
          )}

          <View style={styles.detailsRow}>
            {item.city && (
              <View style={styles.detailItem}>
                <Text style={styles.detailIcon}>?</Text>
                <Text style={styles.detailText} numberOfLines={1}>
                  {item.city}
                </Text>
              </View>
            )}
          </View>

          {item.specialty && (
            <View style={styles.specialtyContainer}>
              <Text style={styles.specialtyLabel}>Specialty:</Text>
              <Text style={styles.specialtyText} numberOfLines={1}>
                {item.specialty}
              </Text>
            </View>
          )}

          {/* Rating */}
          {item.rating > 0 && (
            <View style={styles.ratingRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingText}>
                {item.rating.toFixed(1)}
              </Text>
            </View>
          )}
        </View>

        {/* Arrow */}
        <Text style={styles.arrow}>?</Text>
      </View>
    </Card>
  );

  // Loading state
  if (isLoading && !isRefreshing) {
    return <LoadingScreen message="Loading trainers..." />;
  }

  // Error state
  if (error && trainers.length === 0) {
    return (
      <ErrorState
        message={error}
        onRetry={() => fetchTrainers()}
      />
    );
  }

  // Empty state
  if (!isLoading && trainers.length === 0) {
    return (
      <EmptyState
        title="No Trainers Available"
        message="Private training is coming soon! Check back later for our roster of NCAA and pro trainers."
        icon="?"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {/* Header Info */}
      <View style={styles.headerInfo}>
        <Text style={styles.headerTitle}>Train with the Pros</Text>
        <Text style={styles.headerSubtitle}>
          1-on-1 mentorship with NCAA and professional soccer players
        </Text>
      </View>

      <FlatList
        data={trainers}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderTrainerCard}
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

  // Header
  headerInfo: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    lineHeight: typography.sizes.sm * typography.lineHeights.normal,
  },

  // List
  listContent: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  separator: {
    height: spacing.md,
  },

  // Trainer Card
  trainerCard: {
    padding: spacing.md,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Photo
  trainerPhoto: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.border,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  photoPlaceholderText: {
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },

  // Info
  trainerInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  trainerName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: 2,
  },
  collegeText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.xs,
  },

  // Details
  detailsRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIcon: {
    fontSize: 12,
    marginRight: 4,
  },
  detailText: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },

  // Specialty
  specialtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  specialtyLabel: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginRight: 4,
  },
  specialtyText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    flex: 1,
  },

  // Rating
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stars: {
    fontSize: 12,
    letterSpacing: 1,
  },
  ratingText: {
    fontSize: typography.sizes.xs,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    marginLeft: spacing.xs,
  },

  // Arrow
  arrow: {
    fontSize: 16,
    color: colors.gray,
    marginLeft: spacing.sm,
  },
});

export default TrainersScreen;
