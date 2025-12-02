/**
 * PTP Mobile App - Navigation Configuration
 *
 * Structure:
 * - RootNavigator: Onboarding -> Auth vs Main (based on user state)
 * - AuthStack: Login screen
 * - MainTabs: Home, Camps, Training, Schedule, Messages, Profile
 * - CampsStack: Camps list -> Camp detail
 * - TrainingStack: Trainers list -> Trainer detail
 * - MessagesStack: Chat list -> Chat detail
 */

import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { LoadingScreen } from '../components';
import { colors, typography } from '../theme';

// Screens
import LoginScreen from '../screens/LoginScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import CampsScreen from '../screens/CampsScreen';
import CampDetailScreen from '../screens/CampDetailScreen';
import CartScreen from '../screens/CartScreen';
import CheckoutScreen from '../screens/CheckoutScreen';
import TrainersScreen from '../screens/TrainersScreen';
import TrainerDetailScreen from '../screens/TrainerDetailScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import OrdersScreen from '../screens/OrdersScreen';
import OrderDetailScreen from '../screens/OrderDetailScreen';
import OnboardingScreen, { checkOnboardingComplete } from '../screens/OnboardingScreen';
import HomeScreen from '../screens/HomeScreen';
import ChatListScreen from '../screens/ChatListScreen';
import ChatScreen from '../screens/ChatScreen';

// Types
import {
  RootStackParamList,
  AuthStackParamList,
  MainTabParamList,
  CampsStackParamList,
  TrainingStackParamList,
  MessagesStackParamList,
  ProfileStackParamList,
} from '../types';

// =============================================================================
// Stack Navigators
// =============================================================================

const RootStack = createNativeStackNavigator<RootStackParamList>();
const AuthStackNav = createNativeStackNavigator<AuthStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const CampsStackNav = createNativeStackNavigator<CampsStackParamList>();
const TrainingStackNav = createNativeStackNavigator<TrainingStackParamList>();
const MessagesStackNav = createNativeStackNavigator<MessagesStackParamList>();
const ProfileStackNav = createNativeStackNavigator<ProfileStackParamList>();

// =============================================================================
// Tab Icon Component
// =============================================================================

interface TabIconProps {
  label: string;
  focused: boolean;
}

const TabIcon: React.FC<TabIconProps> = ({ label, focused }) => {
  // Simple text-based icons (can be replaced with vector icons later)
  const getIcon = (): string => {
    switch (label) {
      case 'Home':
        return '🏠';
      case 'Camps':
        return '⚽';
      case 'Training':
        return '🏃';
      case 'Schedule':
        return '📅';
      case 'Messages':
        return '💬';
      case 'Profile':
        return '👤';
      default:
        return '●';
    }
  };

  return (
    <View style={styles.tabIconContainer}>
      <Text style={[styles.tabIcon, focused && styles.tabIconFocused]}>
        {getIcon()}
      </Text>
    </View>
  );
};

// =============================================================================
// Auth Stack (Unauthenticated users)
// =============================================================================

const AuthStack: React.FC = () => {
  return (
    <AuthStackNav.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <AuthStackNav.Screen name="Login" component={LoginScreen} />
      <AuthStackNav.Screen name="Register" component={RegisterScreen} />
      <AuthStackNav.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStackNav.Navigator>
  );
};

// =============================================================================
// Camps Stack
// =============================================================================

const CampsStack: React.FC = () => {
  return (
    <CampsStackNav.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontWeight: typography.weights.semibold,
        },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
      }}
    >
      <CampsStackNav.Screen
        name="Camps"
        component={CampsScreen}
        options={{
          title: 'Camps & Clinics',
        }}
      />
      <CampsStackNav.Screen
        name="CampDetail"
        component={CampDetailScreen}
        options={{
          title: 'Camp Details',
        }}
      />
      <CampsStackNav.Screen
        name="Cart"
        component={CartScreen}
        options={{
          title: 'Your Cart',
        }}
      />
      <CampsStackNav.Screen
        name="Checkout"
        component={CheckoutScreen}
        options={{
          title: 'Checkout',
        }}
      />
    </CampsStackNav.Navigator>
  );
};

// =============================================================================
// Training Stack
// =============================================================================

const TrainingStack: React.FC = () => {
  return (
    <TrainingStackNav.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontWeight: typography.weights.semibold,
        },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
      }}
    >
      <TrainingStackNav.Screen
        name="Trainers"
        component={TrainersScreen}
        options={{
          title: 'Private Training',
        }}
      />
      <TrainingStackNav.Screen
        name="TrainerDetail"
        component={TrainerDetailScreen}
        options={{
          title: 'Trainer Profile',
        }}
      />
    </TrainingStackNav.Navigator>
  );
};

// =============================================================================
// Messages Stack
// =============================================================================

const MessagesStack: React.FC = () => {
  return (
    <MessagesStackNav.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontWeight: typography.weights.semibold,
        },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
      }}
    >
      <MessagesStackNav.Screen
        name="ChatList"
        component={ChatListScreen}
        options={{ title: 'Messages' }}
      />
      <MessagesStackNav.Screen
        name="Chat"
        component={ChatScreen}
        options={{ title: 'Chat' }}
      />
    </MessagesStackNav.Navigator>
  );
};

// =============================================================================
// Profile Stack
// =============================================================================

const ProfileStack: React.FC = () => {
  return (
    <ProfileStackNav.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.white,
        },
        headerTintColor: colors.ink,
        headerTitleStyle: {
          fontWeight: typography.weights.semibold,
        },
        headerShadowVisible: false,
        headerBackTitleVisible: false,
      }}
    >
      <ProfileStackNav.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: 'Profile',
        }}
      />
      <ProfileStackNav.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={{
          title: 'Edit Profile',
        }}
      />
      <ProfileStackNav.Screen
        name="Orders"
        component={OrdersScreen}
        options={{
          title: 'Order History',
        }}
      />
      <ProfileStackNav.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{
          title: 'Order Details',
        }}
      />
    </ProfileStackNav.Navigator>
  );
};

// =============================================================================
// Main Tabs (Authenticated users)
// =============================================================================

const MainTabs: React.FC = () => {
  return (
    <MainTab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.border,
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray,
        tabBarLabelStyle: {
          fontSize: typography.sizes.xs,
          fontWeight: typography.weights.medium,
        },
        headerShown: false,
      }}
    >
      <MainTab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} />,
          headerShown: true,
          headerTitle: 'Home',
          headerStyle: { backgroundColor: colors.white },
          headerTitleStyle: { fontWeight: typography.weights.semibold },
          headerTintColor: colors.ink,
        }}
      />
      <MainTab.Screen
        name="CampsTab"
        component={CampsStack}
        options={{
          tabBarLabel: 'Camps',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Camps" focused={focused} />
          ),
        }}
      />
      <MainTab.Screen
        name="TrainingTab"
        component={TrainingStack}
        options={{
          tabBarLabel: 'Training',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Training" focused={focused} />
          ),
        }}
      />
      <MainTab.Screen
        name="ScheduleTab"
        component={ScheduleScreen}
        options={{
          tabBarLabel: 'Schedule',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Schedule" focused={focused} />
          ),
          headerShown: true,
          headerTitle: 'My Schedule',
          headerStyle: {
            backgroundColor: colors.white,
          },
          headerTintColor: colors.ink,
          headerTitleStyle: {
            fontWeight: typography.weights.semibold,
          },
          headerShadowVisible: false,
        }}
      />
      <MainTab.Screen
        name="MessagesTab"
        component={MessagesStack}
        options={{
          tabBarLabel: 'Messages',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Messages" focused={focused} />
          ),
          headerShown: false,
        }}
      />
      <MainTab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Profile" focused={focused} />
          ),
          headerShown: false,
        }}
      />
    </MainTab.Navigator>
  );
};

// =============================================================================
// Root Navigator
// =============================================================================

const RootNavigator: React.FC = () => {
  const { user, isInitialized, isGuest } = useAuth();
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  // Check if onboarding has been completed
  useEffect(() => {
    const checkOnboarding = async () => {
      const isComplete = await checkOnboardingComplete();
      setShowOnboarding(!isComplete);
    };
    checkOnboarding();
  }, []);

  // Show loading screen while checking auth and onboarding state
  if (!isInitialized || showOnboarding === null) {
    return <LoadingScreen message="Loading..." />;
  }

  // Show onboarding if not completed
  if (showOnboarding) {
    return <OnboardingScreen onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {user || isGuest ? (
        <RootStack.Screen name="Main" component={MainTabs} />
      ) : (
        <RootStack.Screen name="Auth" component={AuthStack} />
      )}
    </RootStack.Navigator>
  );
};

// =============================================================================
// App Navigation Container
// =============================================================================

export const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <RootNavigator />
    </NavigationContainer>
  );
};

// =============================================================================
// Styles
// =============================================================================

const styles = StyleSheet.create({
  tabIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 20,
    color: colors.gray,
  },
  tabIconFocused: {
    color: colors.primary,
  },
});

export default AppNavigator;
