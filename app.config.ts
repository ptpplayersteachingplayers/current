/**
 * PTP Mobile App - Expo Configuration
 *
 * This file provides dynamic configuration for the Expo app.
 * It uses environment variables for sensitive values and
 * configures OTA updates, push notifications, and build settings.
 */

import { ExpoConfig, ConfigContext } from 'expo/config';

// Define environment-specific configurations
const IS_DEV = process.env.APP_VARIANT === 'development';
const IS_PREVIEW = process.env.APP_VARIANT === 'preview';

// App identifiers for different environments
const getAppIdentifier = () => {
  if (IS_DEV) return 'com.ptpsoccer.app.dev';
  if (IS_PREVIEW) return 'com.ptpsoccer.app.preview';
  return 'com.ptpsoccer.app';
};

// App name for different environments
const getAppName = () => {
  if (IS_DEV) return 'PTP Soccer (Dev)';
  if (IS_PREVIEW) return 'PTP Soccer (Preview)';
  return 'PTP Soccer';
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,

  // Basic app info
  name: getAppName(),
  slug: 'ptp-soccer',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',

  // App icons and splash screen
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#0E0F11', // PTP Ink Black
  },

  // Adaptive icon for Android
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0E0F11',
    },
    package: getAppIdentifier(),
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || './google-services.json',
    permissions: [
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
    ],
  },

  // iOS configuration
  ios: {
    supportsTablet: true,
    bundleIdentifier: getAppIdentifier(),
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST || './GoogleService-Info.plist',
    infoPlist: {
      NSCameraUsageDescription: 'Allow PTP Soccer to access your camera for profile photos.',
      NSPhotoLibraryUsageDescription: 'Allow PTP Soccer to access your photo library for profile photos.',
      NSLocationWhenInUseUsageDescription: 'Allow PTP Soccer to find camps and trainers near you.',
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },

  // Web configuration (if needed)
  web: {
    bundler: 'metro',
    favicon: './assets/favicon.png',
  },

  // Expo Updates (OTA) Configuration
  updates: {
    enabled: true,
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/' + (process.env.EXPO_PUBLIC_PROJECT_ID || ''),
    checkAutomatically: 'ON_LOAD',
  },

  // Runtime version for OTA updates
  runtimeVersion: {
    policy: 'appVersion',
  },

  // Extra configuration exposed to the app
  extra: {
    // API Configuration
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || 'https://ptpsummercamps.com/wp-json',

    // Supabase Configuration (for messaging)
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',

    // Feature flags
    enablePrivateTraining: true,
    enableMessaging: true,

    // Environment info
    appVariant: process.env.APP_VARIANT || 'production',

    // EAS Configuration
    eas: {
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID || '',
    },
  },

  // Plugins
  plugins: [
    // Expo Router (if using file-based routing)
    // 'expo-router',

    // Push Notifications
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#FCB900', // PTP Yellow
        sounds: ['./assets/sounds/notification.wav'],
      },
    ],

    // Secure Store
    'expo-secure-store',

    // Device info
    'expo-device',

    // Font loading
    'expo-font',

    // Safe area handling
    'react-native-safe-area-context',
  ],

  // Asset bundler patterns
  assetBundlePatterns: ['**/*'],

  // Scheme for deep linking
  scheme: 'ptpsoccer',

  // Experiments
  experiments: {
    typedRoutes: true,
  },

  // Owner (your Expo account)
  owner: 'ptpsoccer',
});
