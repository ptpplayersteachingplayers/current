/**
 * PTP Mobile App - Profile Screen
 *
 * Features:
 * - User info display
 * - Notification settings
 * - Logout functionality
 * - About/Support links
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { Card, PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const ProfileScreen: React.FC = () => {
  const { user, logout, isLoading, isGuest } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            setIsLoggingOut(true);
            try {
              await logout();
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  const handleOpenNotificationSettings = () => {
    if (Platform.OS === 'ios') {
      Linking.openURL('app-settings:');
    } else {
      Linking.openSettings();
    }
  };

  const handleContactSupport = () => {
    Linking.openURL('mailto:info@ptpsummercamps.com?subject=PTP App Support');
  };

  const handleVisitWebsite = () => {
    Linking.openURL('https://ptpsummercamps.com');
  };

  const handlePrivacyPolicy = () => {
    Linking.openURL('https://ptpsummercamps.com/privacy-policy');
  };

  const handleTermsOfService = () => {
    Linking.openURL('https://ptpsummercamps.com/terms');
  };

  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Guest view - prompt to login
  if (isGuest && !user) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <View style={styles.guestContainer}>
          <View style={styles.guestIconContainer}>
            <Ionicons name="person-outline" size={48} color={colors.gray} />
          </View>
          <Text style={styles.guestTitle}>Sign In to View Profile</Text>
          <Text style={styles.guestSubtitle}>
            Create an account or sign in to access your profile, view your schedule, and manage your camps.
          </Text>
          <PrimaryButton
            title="Sign In"
            onPress={logout}
            style={styles.guestButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {user ? getInitials(user.name) : 'PTP'}
            </Text>
          </View>

          <Text style={styles.userName}>{user?.name || 'PTP User'}</Text>
          <Text style={styles.userEmail}>{user?.email || ''}</Text>
        </View>

        {/* Account Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>

          <Card style={styles.menuCard} noPadding>
            <MenuItem
              iconName="notifications-outline"
              label="Manage Notifications"
              onPress={handleOpenNotificationSettings}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              iconName="mail-outline"
              label="Contact Support"
              onPress={handleContactSupport}
            />
            <View style={styles.menuDivider} />
            <MenuItem
              iconName="globe-outline"
              label="Visit Website"
              onPress={handleVisitWebsite}
              external
            />
          </Card>
        </View>

        {/* Legal Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>

          <Card style={styles.menuCard} noPadding>
            <MenuItem
              iconName="shield-checkmark-outline"
              label="Privacy Policy"
              onPress={handlePrivacyPolicy}
              external
            />
            <View style={styles.menuDivider} />
            <MenuItem
              iconName="document-text-outline"
              label="Terms of Service"
              onPress={handleTermsOfService}
              external
            />
          </Card>
        </View>

        {/* Logout Button */}
        <View style={styles.logoutSection}>
          <PrimaryButton
            title="Log Out"
            onPress={handleLogout}
            variant="outline"
            loading={isLoggingOut}
            disabled={isLoading || isLoggingOut}
          />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.logoContainer}>
            <Text style={styles.logoText}>PTP</Text>
          </View>
          <Text style={styles.footerText}>Players Teaching Players</Text>
          <Text style={styles.versionText}>Version 1.0.0</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

// Menu Item Component
interface MenuItemProps {
  iconName: IoniconsName;
  label: string;
  onPress: () => void;
  external?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ iconName, label, onPress, external }) => (
  <TouchableOpacity
    style={styles.menuItem}
    onPress={onPress}
    activeOpacity={0.7}
  >
    <View style={styles.menuIconContainer}>
      <Ionicons name={iconName} size={20} color={colors.ink} />
    </View>
    <Text style={styles.menuLabel}>{label}</Text>
    <Ionicons
      name={external ? 'open-outline' : 'chevron-forward'}
      size={16}
      color={colors.gray}
    />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },

  // Profile Header
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.full,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontSize: 28,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  userName: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  userEmail: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },

  // Section
  section: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.semibold,
    color: colors.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
    marginLeft: spacing.xs,
  },

  // Menu Card
  menuCard: {
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  menuIconContainer: {
    marginRight: spacing.md,
    width: 28,
    alignItems: 'center',
  },
  menuLabel: {
    flex: 1,
    fontSize: typography.sizes.md,
    color: colors.ink,
  },
  menuDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 28 + spacing.md, // Align with text
  },

  // Logout Section
  logoutSection: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },

  // Footer
  footer: {
    alignItems: 'center',
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xl,
  },
  logoContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  logoText: {
    fontSize: 16,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  footerText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.xs,
  },
  versionText: {
    fontSize: typography.sizes.xs,
    color: colors.grayLight,
  },

  // Guest Styles
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
  guestButton: {
    width: '100%',
  },
});

export default ProfileScreen;
