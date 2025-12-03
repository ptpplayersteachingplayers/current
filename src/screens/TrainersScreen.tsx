/**
 * PTP Mobile App - Trainers Screen
 *
 * React Query powered trainer list with pull-to-refresh.
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
import { Ionicons } from '@expo/vector-icons';
import { useTrainersQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, LoadingScreen, ErrorState, EmptyState } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { Trainer, TrainingStackParamList } from '../types';

type Props = NativeStackScreenProps<TrainingStackParamList, 'Trainers'>;

const TrainersScreen: React.FC<Props> = ({ navigation }) => {
  const { logout } = useAuth();

  const {
    data: trainers = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useTrainersQuery();

  const typedError = useMemo(() => {
    if (error && error instanceof Error) return error;
    return null;
  }, [error]);

  const errorMessage = typedError?.message || 'Failed to load trainers. Please try again.';

  const handleTrainerPress = (trainer: Trainer) => {
    navigation.navigate('TrainerDetail', { trainer });
  };

  const handleRefresh = () => {
    refetch();
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

  const renderTrainerCard = ({ item }: { item: Trainer }) => (
    <Card style={styles.trainerCard} onPress={() => handleTrainerPress(item)}>
      <View style={styles.cardContent}>
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
                <Ionicons name="location-outline" size={12} color={colors.gray} style={styles.detailIcon} />
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

          {item.rating > 0 && (
            <View style={styles.ratingRow}>
              {renderStars(item.rating)}
              <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
            </View>
          )}
        </View>

        <Text style={styles.arrow}>›</Text>
      </View>
    </Card>
  );

  if (isLoading && !isRefetching) {
    return <LoadingScreen message="Loading trainers..." />;
  }

  if (isError && trainers.length === 0) {
    if ((typedError as any)?.isSessionExpired?.()) {
      logout();
    }
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />;
  }

  if (!isLoading && trainers.length === 0) {
    return (
      <EmptyState
        title="No Trainers Available"
        message="Private training is coming soon! Check back later for our roster of NCAA and pro trainers."
        iconName="fitness-outline"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
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
  listContent: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  separator: {
    height: spacing.md,
  },
  trainerCard: {
    padding: spacing.md,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
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
  detailsRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailIcon: {
    marginRight: 4,
  },
  detailText: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
  },
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
  arrow: {
    fontSize: 16,
    color: colors.gray,
    marginLeft: spacing.sm,
  },
});

export default TrainersScreen;
