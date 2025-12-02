/**
 * PTP Mobile App - Schedule Screen
 *
 * React Query driven schedule with chat entry points.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSessionsQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, LoadingScreen, ErrorState, Badge, PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { Session, MainTabParamList } from '../types';
import { ensureSupportConversation } from '../api/chat';

type ScheduleNavigationProp = BottomTabNavigationProp<MainTabParamList, 'ScheduleTab'>;

interface SectionData {
  title: string;
  data: Session[];
}

const ScheduleScreen: React.FC = () => {
  const { logout, isGuest, user } = useAuth();
  const navigation = useNavigation<ScheduleNavigationProp>();

  const {
    data: sessions = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useSessionsQuery(Boolean(user) && !isGuest);

  const typedError = useMemo(() => {
    if (error && error instanceof Error) return error;
    return null;
  }, [error]);

  const errorMessage = typedError?.message || 'Failed to load your schedule. Please try again.';

  const handleRefresh = () => {
    refetch();
  };

  const handleBrowseCamps = () => {
    navigation.navigate('CampsTab');
  };

  const handleBrowseTraining = () => {
    navigation.navigate('TrainingTab');
  };

  const handleChat = async (session: Session) => {
    if (!user) return;
    try {
      const conversation = await ensureSupportConversation(String(user.id), user.name);
      navigation.navigate('MessagesTab', {
        screen: 'Chat',
        params: { conversationId: conversation.id, title: session.name },
      } as any);
    } catch (err) {
      console.warn('Unable to open conversation', err);
    }
  };

  const groupSessionsByDate = (sessionList: Session[]): SectionData[] => {
    const grouped: { [key: string]: Session[] } = {};
    const sorted = [...sessionList].sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateA.getTime() - dateB.getTime();
    });

    sorted.forEach((session) => {
      const dateKey = session.date || 'Date TBD';
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(session);
    });

    return Object.entries(grouped).map(([title, data]) => ({
      title,
      data,
    }));
  };

  const getSessionTypeLabel = (type: string): string => {
    switch (type) {
      case 'camp':
        return 'Camp';
      case 'clinic':
        return 'Clinic';
      case 'training':
        return 'Training';
      default:
        return 'Event';
    }
  };

  const getStatusVariant = (status: string): 'success' | 'warning' | 'info' => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'cancelled':
        return 'warning';
      default:
        return 'info';
    }
  };

  const renderSessionItem = ({ item }: { item: Session }) => (
    <Card style={styles.sessionCard}>
      <View style={styles.sessionHeader}>
        <Badge label={getSessionTypeLabel(item.type)} variant="info" />
        {item.status !== 'upcoming' && (
          <Badge
            label={item.status.charAt(0).toUpperCase() + item.status.slice(1)}
            variant={getStatusVariant(item.status)}
            style={styles.statusBadge}
          />
        )}
      </View>

      <Text style={styles.sessionName} numberOfLines={2}>
        {item.name}
      </Text>

      <View style={styles.detailsContainer}>
        {item.time && (
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>⏰</Text>
            <Text style={styles.detailText}>{item.time}</Text>
          </View>
        )}

        {item.location && (
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>📍</Text>
            <Text style={styles.detailText}>{item.location}</Text>
          </View>
        )}

        {item.trainer_name && (
          <View style={styles.detailRow}>
            <Text style={styles.detailIcon}>🎯</Text>
            <Text style={styles.detailText}>Coach: {item.trainer_name}</Text>
          </View>
        )}
      </View>

      {user && (
        <PrimaryButton
          title="Chat about this session"
          onPress={() => handleChat(item)}
          variant="outline"
          style={styles.chatButton}
        />
      )}
    </Card>
  );

  const renderSectionHeader = ({ section }: { section: SectionData }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionDate}>{section.title}</Text>
      <Text style={styles.sectionCount}>
        {section.data.length} {section.data.length === 1 ? 'event' : 'events'}
      </Text>
    </View>
  );

  if (isGuest && !user) {
    return (
      <View style={styles.guestContainer}>
        <View style={styles.guestIconContainer}>
          <Text style={styles.guestIcon}>📅</Text>
        </View>
        <Text style={styles.guestTitle}>Sign In to View Schedule</Text>
        <Text style={styles.guestSubtitle}>
          Sign in to see your registered camps, clinics, and training sessions.
        </Text>
        <PrimaryButton
          title="Sign In"
          onPress={logout}
          style={styles.guestSignInButton}
        />
        <View style={styles.guestBrowseButtons}>
          <PrimaryButton
            title="Browse Camps"
            onPress={handleBrowseCamps}
            variant="outline"
            style={styles.guestBrowseButton}
          />
        </View>
      </View>
    );
  }

  if (isLoading && !isRefetching) {
    return <LoadingScreen message="Loading your schedule..." />;
  }

  if (isError && sessions.length === 0) {
    if ((typedError as any)?.isSessionExpired?.()) {
      logout();
    }
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />;
  }

  if (!isLoading && sessions.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyContent}>
          <View style={styles.emptyIconContainer}>
            <Text style={styles.emptyIcon}>⚽</Text>
          </View>
          <Text style={styles.emptyTitle}>No Upcoming Events</Text>
          <Text style={styles.emptyMessage}>
            You don't have any camps, clinics, or training sessions scheduled yet.
          </Text>

          <View style={styles.emptyActions}>
            <PrimaryButton
              title="Browse Camps"
              onPress={handleBrowseCamps}
              style={styles.emptyButton}
            />
            <PrimaryButton
              title="Find a Trainer"
              onPress={handleBrowseTraining}
              variant="outline"
              style={styles.emptyButton}
            />
          </View>
        </View>
      </View>
    );
  }

  const sections = groupSessionsByDate(sessions);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderSessionItem}
        renderSectionHeader={renderSectionHeader}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={styles.sectionSeparator} />}
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
    height: spacing.md,
  },
  sectionSeparator: {
    height: spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.md,
  },
  sectionDate: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  sectionCount: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  sessionCard: {
    padding: spacing.lg,
  },
  sessionHeader: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  statusBadge: {
    marginLeft: spacing.sm,
  },
  sessionName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
    lineHeight: typography.sizes.md * typography.lineHeights.tight,
  },
  detailsContainer: {
    backgroundColor: colors.offWhite,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  detailRow: {
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
  chatButton: {
    marginTop: spacing.md,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  emptyContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  emptyIcon: {
    fontSize: 36,
  },
  emptyTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
    marginBottom: spacing.xxl,
    maxWidth: 280,
  },
  emptyActions: {
    width: '100%',
    maxWidth: 280,
  },
  emptyButton: {
    marginBottom: spacing.md,
  },
  guestContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.white,
  },
  guestIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  guestIcon: {
    fontSize: 48,
  },
  guestTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  guestSubtitle: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  guestSignInButton: {
    width: '100%',
    marginBottom: spacing.lg,
  },
  guestBrowseButtons: {
    width: '100%',
  },
  guestBrowseButton: {
    marginBottom: spacing.md,
  },
});

export default ScheduleScreen;
