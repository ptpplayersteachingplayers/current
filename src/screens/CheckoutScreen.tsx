/**
 * PTP Mobile App - Checkout Screen
 *
 * WebView-based checkout that loads the WooCommerce checkout page.
 * Handles authentication passthrough and order completion detection.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { getAuthToken } from '../api/client';
import { PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { CheckoutParams } from '../types';

type RootStackParamList = {
  Checkout: CheckoutParams;
};

type Props = NativeStackScreenProps<RootStackParamList, 'Checkout'>;

const CheckoutScreen: React.FC<Props> = ({ route, navigation }) => {
  const { productUrl, productName } = route.params;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const webViewRef = useRef<WebView>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(productUrl);
  const [hasError, setHasError] = useState(false);
  const [orderCompleted, setOrderCompleted] = useState(false);

  // Detect order completion URLs
  const isOrderConfirmation = (url: string): boolean => {
    return (
      url.includes('order-received') ||
      url.includes('checkout/order-received') ||
      url.includes('thank-you') ||
      url.includes('order-complete')
    );
  };

  // Handle URL changes
  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCurrentUrl(navState.url);

    // Check for order completion
    if (isOrderConfirmation(navState.url) && !orderCompleted) {
      setOrderCompleted(true);
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    }
  };

  // Handle hardware back button
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      }
    );

    return () => backHandler.remove();
  }, [canGoBack]);

  // Inject authentication if user is logged in
  const getInjectedJavaScript = (): string => {
    const token = getAuthToken();
    if (!token) return '';

    // This script attempts to auto-fill user info if available
    return `
      (function() {
        // Store token for potential API calls
        window.ptpAuthToken = '${token}';

        // Auto-fill email if we can find the billing email field
        const emailField = document.querySelector('#billing_email, input[name="billing_email"]');
        if (emailField && !emailField.value && '${user?.email || ''}') {
          emailField.value = '${user?.email || ''}';
        }

        // Try to auto-fill name
        const firstNameField = document.querySelector('#billing_first_name, input[name="billing_first_name"]');
        if (firstNameField && !firstNameField.value) {
          const nameParts = '${user?.name || ''}'.split(' ');
          if (nameParts[0]) firstNameField.value = nameParts[0];
        }

        const lastNameField = document.querySelector('#billing_last_name, input[name="billing_last_name"]');
        if (lastNameField && !lastNameField.value) {
          const nameParts = '${user?.name || ''}'.split(' ');
          if (nameParts.length > 1) lastNameField.value = nameParts.slice(1).join(' ');
        }
      })();
      true;
    `;
  };

  // Handle going back with confirmation
  const handleClose = () => {
    if (orderCompleted) {
      navigation.goBack();
      return;
    }

    Alert.alert(
      'Leave Checkout?',
      'Are you sure you want to leave? Your cart will not be saved.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => navigation.goBack() },
      ]
    );
  };

  // Handle order completion
  const handleOrderComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    navigation.goBack();
  };

  const handleRetry = () => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  };

  if (hasError) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="wifi-outline" size={48} color={colors.gray} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>
            Unable to load the checkout page. Please check your internet
            connection and try again.
          </Text>
          <PrimaryButton
            title="Try Again"
            onPress={handleRetry}
            style={styles.retryButton}
          />
          <PrimaryButton
            title="Go Back"
            onPress={() => navigation.goBack()}
            variant="outline"
            style={styles.backButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (orderCompleted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={colors.success} />
          </View>
          <Text style={styles.successTitle}>Order Complete!</Text>
          <Text style={styles.successMessage}>
            Thank you for your registration. You'll receive a confirmation email
            shortly with all the details.
          </Text>
          <PrimaryButton
            title="View My Schedule"
            onPress={handleOrderComplete}
            style={styles.successButton}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <PrimaryButton
          title="Cancel"
          onPress={handleClose}
          variant="outline"
          size="sm"
        />
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {productName || 'Checkout'}
          </Text>
          {isLoading && (
            <ActivityIndicator
              size="small"
              color={colors.primary}
              style={styles.loadingIndicator}
            />
          )}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Secure checkout badge */}
      <View style={styles.secureBadge}>
        <Ionicons name="lock-closed" size={12} color={colors.success} />
        <Text style={styles.secureBadgeText}>Secure Checkout</Text>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: productUrl }}
        style={styles.webView}
        onNavigationStateChange={handleNavigationStateChange}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          if (nativeEvent.statusCode >= 400) {
            setHasError(true);
          }
        }}
        injectedJavaScript={getInjectedJavaScript()}
        javaScriptEnabled
        domStorageEnabled
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading checkout...</Text>
          </View>
        )}
        // Security settings
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        // Handle external links
        onShouldStartLoadWithRequest={(request) => {
          // Allow navigation within the checkout flow
          if (
            request.url.includes('ptpsummercamps.com') ||
            request.url.includes('stripe.com') ||
            request.url.includes('paypal.com')
          ) {
            return true;
          }
          // Block other external navigations
          return request.url === productUrl;
        }}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.white,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitleContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.md,
  },
  headerTitle: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    textAlign: 'center',
  },
  loadingIndicator: {
    marginLeft: spacing.sm,
  },
  headerSpacer: {
    width: 70, // Match cancel button width for centering
  },

  // Secure Badge
  secureBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    backgroundColor: colors.offWhite,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  secureBadgeText: {
    fontSize: typography.sizes.xs,
    color: colors.success,
    marginLeft: spacing.xs,
    fontWeight: typography.weights.medium,
  },

  // WebView
  webView: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },

  // Error State
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  errorTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  errorMessage: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 24,
  },
  retryButton: {
    width: '100%',
    marginBottom: spacing.md,
  },
  backButton: {
    width: '100%',
  },

  // Success State
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  successIcon: {
    marginBottom: spacing.lg,
  },
  successTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.md,
  },
  successMessage: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    textAlign: 'center',
    marginBottom: spacing.xxl,
    lineHeight: 24,
    maxWidth: 300,
  },
  successButton: {
    width: '100%',
    maxWidth: 280,
  },
});

export default CheckoutScreen;
