/**
 * PTP Mobile App - Entry Point
 *
 * Players Teaching Players Soccer Camps
 */

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './src/context/AuthContext';
import { ChatProvider } from './src/context/ChatContext';
import { AppNavigator } from './src/navigation';
import queryClient from './src/api/queryClient';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ChatProvider>
            <AppNavigator />
          </ChatProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
