/**
 * PTP Mobile App - Child Profiles Screen
 *
 * Lists all child profiles for the authenticated user with
 * options to add, edit, and delete profiles.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import {
  useChildProfilesQuery,
  useDeleteChildProfileMutation,
} from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, LoadingScreen, ErrorState, PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { ChildProfile, ProfileStackParamList } from '../types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ChildProfiles'>;

const ChildProfilesScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();
  const {
    data: children = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useChildProfilesQuery(Boolean(user));

  const deleteMutation = useDeleteChildProfileMutation();

  const handleAddChild = () => {
    navigation.navigate('AddChildProfile');
  };

  const handleEditChild = (child: ChildProfile) => {
    navigation.navigate('EditChildProfile', { child });
  };

  const handleDeleteChild = (child: ChildProfile) => {
    Alert.alert(
      'Delete Profile',
      `Are you sure you want to delete ${child.name}'s profile? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync(child.id);
            } catch (err) {
              Alert.alert(
                'Error',
                'Failed to delete profile. Please try again.'
              );
            }
          },
        },
      ]
    );
  };

  const getExperienceLevelLabel = (level?: string): string => {
    switch (level) {
      case 'beginner':
        return 'Beginner';
      case 'intermediate':
        return 'Intermediate';
      case 'advanced':
        return 'Advanced';
      case 'competitive':
        return 'Competitive';
      default:
        return 'Not specified';
    }
  };

  const calculateAge = (birthDate?: string): number | undefined => {
    if (!birthDate) return undefined;
    const today = new Date();
    const birth = new Date(birthDate);
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  };

  const renderChildCard = ({ item }: { item: ChildProfile }) => {
    const age = item.age ?? calculateAge(item.birth_date);

    return (
      <Card style={styles.childCard}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {item.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.childName}>{item.name}</Text>
            {age !== undefined && (
              <Text style={styles.childAge}>
                {age} years old
              </Text>
            )}
          </View>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => handleEditChild(item)}
          >
            <Ionicons name="pencil" size={18} color={colors.gray} />
          </TouchableOpacity>
        </View>

        <View style={styles.detailsContainer}>
          {item.experience_level && (
            <View style={styles.detailRow}>
              <Ionicons
                name="trophy-outline"
                size={14}
                color={colors.gray}
                style={styles.detailIcon}
              />
              <Text style={styles.detailText}>
                {getExperienceLevelLabel(item.experience_level)}
              </Text>
            </View>
          )}

          {item.team && (
            <View style={styles.detailRow}>
              <Ionicons
                name="people-outline"
                size={14}
                color={colors.gray}
                style={styles.detailIcon}
              />
              <Text style={styles.detailText}>{item.team}</Text>
            </View>
          )}

          {item.position && (
            <View style={styles.detailRow}>
              <Ionicons
                name="football-outline"
                size={14}
                color={colors.gray}
                style={styles.detailIcon}
              />
              <Text style={styles.detailText}>{item.position}</Text>
            </View>
          )}

          {item.tshirt_size && (
            <View style={styles.detailRow}>
              <Ionicons
                name="shirt-outline"
                size={14}
                color={colors.gray}
                style={styles.detailIcon}
              />
              <Text style={styles.detailText}>Size: {item.tshirt_size}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.editButton}
            onPress={() => handleEditChild(item)}
          >
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={() => handleDeleteChild(item)}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      </Card>
    );
  };

  if (isLoading && !isRefetching) {
    return <LoadingScreen message="Loading children..." />;
  }

  if (isError) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to load children. Please try again.';
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      {children.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="people-outline" size={48} color={colors.gray} />
          </View>
          <Text style={styles.emptyTitle}>No Children Added</Text>
          <Text style={styles.emptyMessage}>
            Add your child's profile to easily register them for camps and
            track their sessions.
          </Text>
          <PrimaryButton
            title="Add Child"
            onPress={handleAddChild}
            style={styles.emptyButton}
          />
        </View>
      ) : (
        <FlatList
          data={children}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderChildCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListHeaderComponent={
            <View style={styles.headerContainer}>
              <Text style={styles.headerTitle}>Your Children</Text>
              <Text style={styles.headerSubtitle}>
                {children.length} {children.length === 1 ? 'profile' : 'profiles'}
              </Text>
            </View>
          }
          ListFooterComponent={
            <PrimaryButton
              title="Add Another Child"
              onPress={handleAddChild}
              variant="outline"
              style={styles.addButton}
            />
          }
        />
      )}
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
    height: spacing.md,
  },
  headerContainer: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginTop: spacing.xs,
  },

  // Child Card
  childCard: {
    padding: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  headerInfo: {
    flex: 1,
    marginLeft: spacing.md,
  },
  childName: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  childAge: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginTop: 2,
  },
  menuButton: {
    padding: spacing.sm,
  },

  // Details
  detailsContainer: {
    backgroundColor: colors.offWhite,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  detailRow: {
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
  },

  // Card Actions
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  editButtonText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.ink,
  },
  deleteButton: {
    padding: spacing.sm,
  },

  // Add Button
  addButton: {
    marginTop: spacing.lg,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 24,
    maxWidth: 280,
  },
  emptyButton: {
    width: '100%',
    maxWidth: 280,
  },
});

export default ChildProfilesScreen;
