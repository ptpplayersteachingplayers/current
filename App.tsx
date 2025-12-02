/**
 * PTP Mobile App - Entry Point
 *
 * Players Teaching Players Soccer Camps
 *
 * This is the main entry point for the Expo application.
 * It sets up:
 * - Safe area context for proper insets
 * - Status bar configuration
 * - Authentication provider
 * - Navigation container
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from './src/context/AuthContext';
import { AppNavigator } from './src/navigation';

// Prevent the splash screen from auto-hiding
// We'll hide it once the app is ready
SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore errors - splash screen may have already been hidden
});

export default function App() {
  useEffect(() => {
    // Hide splash screen once app is mounted
    const hideSplash = async () => {
      try {
        await SplashScreen.hideAsync();
      } catch {
        // Ignore errors
      }
    };

    // Small delay to ensure smooth transition
    const timer = setTimeout(hideSplash, 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
