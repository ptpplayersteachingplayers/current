import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSessionsQuery, useAppConfigQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, PrimaryButton, LoadingScreen } from '../components';
import { colors, spacing, typography } from '../theme';
import { AppBanner, MainTabParamList } from '../types';
import { ensureSupportConversation } from '../api/chat';

type HomeNav = BottomTabNavigationProp<MainTabParamList, 'HomeTab'>;

const HomeScreen: React.FC = () => {
  const navigation = useNavigation<HomeNav>();
  const { user } = useAuth();
  const { data: sessions = [], isLoading: sessionsLoading } = useSessionsQuery(Boolean(user));
  const { data: appConfig, isLoading: configLoading } = useAppConfigQuery();

  const nextSession = useMemo(() => {
    if (!sessions.length) return null;
    const sorted = [...sessions].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    return sorted[0];
  }, [sessions]);

  const banner: AppBanner | undefined = appConfig?.banners?.[0];

  const handleMessageSupport = async () => {
    if (!user) return;
    try {
      const conversation = await ensureSupportConversation(String(user.id), user.name);
      navigation.navigate('MessagesTab', {
        screen: 'Chat',
        params: { conversationId: conversation.id, title: 'PTP Support' },
      } as any);
    } catch (err) {
      console.warn('Unable to start support chat', err);
    }
  };

  const handleBannerPress = () => {
    if (banner?.url) {
      Linking.openURL(banner.url);
    }
  };

  const greeting = user?.name ? `Hi, ${user.name.split(' ')[0]}` : 'Welcome to PTP';

  if (sessionsLoading && configLoading) {
    return <LoadingScreen message="Loading your home feed..." />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>{greeting}</Text>
      <Text style={styles.subheading}>Your concierge for camps, training, and support.</Text>

      <Card style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Next Session</Text>
          <Text style={styles.sectionHint}>Up next for your family</Text>
        </View>

        {nextSession ? (
          <View>
            <Text style={styles.sessionName}>{nextSession.name}</Text>
            <Text style={styles.sessionDetail}>{nextSession.date}</Text>
            {nextSession.time ? <Text style={styles.sessionDetail}>{nextSession.time}</Text> : null}
            {nextSession.location ? (
              <Text style={styles.sessionDetail}>{nextSession.location}</Text>
            ) : null}

            <View style={styles.actionsRow}>
              <PrimaryButton
                title="View Details"
                onPress={() => navigation.navigate('ScheduleTab')}
                style={styles.actionButton}
              />
              <PrimaryButton
                title="Message PTP"
                onPress={handleMessageSupport}
                variant="outline"
                style={styles.actionButton}
              />
            </View>
          </View>
        ) : (
          <Text style={styles.placeholderText}>No upcoming sessions yet.</Text>
        )}
      </Card>

      {banner && (
        <Card style={styles.bannerCard} onPress={handleBannerPress}>
          <Text style={styles.bannerTitle}>{banner.title}</Text>
          <Text style={styles.bannerBody}>{banner.body}</Text>
          <PrimaryButton title={banner.ctaText} onPress={handleBannerPress} style={styles.bannerCta} />
        </Card>
      )}

      <Card style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Quick Links</Text>
        <View style={styles.quickLinks}>
          <PrimaryButton
            title="Find Camps & Clinics"
            onPress={() => navigation.navigate('CampsTab')}
            style={styles.quickLinkButton}
          />
          <PrimaryButton
            title="Message Your Coach"
            onPress={() => navigation.navigate('MessagesTab')}
            variant="outline"
            style={styles.quickLinkButton}
          />
        </View>
      </Card>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  content: {
    padding: spacing.lg,
  },
  greeting: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  subheading: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    marginBottom: spacing.lg,
  },
  sectionCard: {
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  sectionHint: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  sessionName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  sessionDetail: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  actionButton: {
    flex: 1,
    marginRight: spacing.sm,
  },
  placeholderText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  bannerCard: {
    padding: spacing.lg,
    marginBottom: spacing.lg,
    backgroundColor: colors.white,
  },
  bannerTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  bannerBody: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.sm,
  },
  bannerCta: {
    alignSelf: 'flex-start',
  },
  quickLinks: {
    marginTop: spacing.sm,
  },
  quickLinkButton: {
    marginBottom: spacing.sm,
  },
});

export default HomeScreen;
