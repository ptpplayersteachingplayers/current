/**
 * PTP Mobile App - Checkout Screen
 *
 * Features:
 * - Order summary
 * - Billing information
 * - Payment method selection
 * - Place order
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PrimaryButton, Card, LoadingScreen } from '../components';
import { colors, spacing, typography, borderRadius, componentStyles } from '../theme';
import { CampsStackParamList } from '../types';
import { getCart, createOrder } from '../api/client';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<CampsStackParamList, 'Checkout'>;

const CheckoutScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Form state
  const [billingInfo, setBillingInfo] = useState({
    firstName: user?.name.split(' ')[0] || '',
    lastName: user?.name.split(' ').slice(1).join(' ') || '',
    email: user?.email || '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
  });

  const [paymentMethod, setPaymentMethod] = useState<'card' | 'paypal'>('card');
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: cartItems = [], isLoading: cartLoading } = useQuery({
    queryKey: ['cart'],
    queryFn: getCart,
  });

  const orderMutation = useMutation({
    mutationFn: createOrder,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });

      // Navigate to order confirmation or open payment URL
      if (data.paymentUrl) {
        Linking.openURL(data.paymentUrl);
      }

      Alert.alert(
        'Order Placed!',
        'Your registration has been submitted. You will receive a confirmation email shortly.',
        [
          {
            text: 'View Orders',
            onPress: () => navigation.navigate('Orders'),
          },
        ]
      );
    },
    onError: (error) => {
      Alert.alert(
        'Order Failed',
        error instanceof Error ? error.message : 'Failed to place order. Please try again.'
      );
    },
  });

  const calculateSubtotal = (): number => {
    return cartItems.reduce((sum, item) => {
      const price = parseFloat(item.price.replace(/[^0-9.]/g, ''));
      return sum + price * item.quantity;
    }, 0);
  };

  const calculateTotal = (): string => {
    const subtotal = calculateSubtotal();
    // Add any fees/taxes here
    return `$${subtotal.toFixed(2)}`;
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!billingInfo.firstName.trim()) {
      newErrors.firstName = 'First name is required';
    }
    if (!billingInfo.lastName.trim()) {
      newErrors.lastName = 'Last name is required';
    }
    if (!billingInfo.email.trim()) {
      newErrors.email = 'Email is required';
    }
    if (!billingInfo.phone.trim()) {
      newErrors.phone = 'Phone is required';
    }
    if (!billingInfo.address.trim()) {
      newErrors.address = 'Address is required';
    }
    if (!billingInfo.city.trim()) {
      newErrors.city = 'City is required';
    }
    if (!billingInfo.state.trim()) {
      newErrors.state = 'State is required';
    }
    if (!billingInfo.zipCode.trim()) {
      newErrors.zipCode = 'ZIP code is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handlePlaceOrder = () => {
    if (!validateForm()) {
      Alert.alert('Missing Information', 'Please fill in all required fields.');
      return;
    }

    orderMutation.mutate({
      billing: billingInfo,
      paymentMethod,
      items: cartItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    });
  };

  if (cartLoading) {
    return <LoadingScreen message="Loading checkout..." />;
  }

  const updateBillingField = (field: string, value: string) => {
    setBillingInfo((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Order Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Order Summary</Text>
            <Card style={styles.card}>
              {cartItems.map((item) => (
                <View key={item.id} style={styles.orderItem}>
                  <View style={styles.orderItemInfo}>
                    <Text style={styles.orderItemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.orderItemQty}>Qty: {item.quantity}</Text>
                  </View>
                  <Text style={styles.orderItemPrice}>{item.price}</Text>
                </View>
              ))}

              <View style={styles.divider} />

              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{calculateTotal()}</Text>
              </View>
            </Card>
          </View>

          {/* Billing Information */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Information</Text>
            <Card style={styles.card}>
              <View style={styles.nameRow}>
                <View style={[styles.inputGroup, styles.halfInput]}>
                  <Text style={styles.label}>First Name *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'firstName' && styles.inputFocused,
                      errors.firstName && styles.inputError,
                    ]}
                    value={billingInfo.firstName}
                    onChangeText={(v) => updateBillingField('firstName', v)}
                    placeholder="First name"
                    placeholderTextColor={colors.grayLight}
                    onFocus={() => setFocusedField('firstName')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>

                <View style={[styles.inputGroup, styles.halfInput]}>
                  <Text style={styles.label}>Last Name *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'lastName' && styles.inputFocused,
                      errors.lastName && styles.inputError,
                    ]}
                    value={billingInfo.lastName}
                    onChangeText={(v) => updateBillingField('lastName', v)}
                    placeholder="Last name"
                    placeholderTextColor={colors.grayLight}
                    onFocus={() => setFocusedField('lastName')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email *</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'email' && styles.inputFocused,
                    errors.email && styles.inputError,
                  ]}
                  value={billingInfo.email}
                  onChangeText={(v) => updateBillingField('email', v)}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.grayLight}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Phone *</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'phone' && styles.inputFocused,
                    errors.phone && styles.inputError,
                  ]}
                  value={billingInfo.phone}
                  onChangeText={(v) => updateBillingField('phone', v)}
                  placeholder="(555) 123-4567"
                  placeholderTextColor={colors.grayLight}
                  keyboardType="phone-pad"
                  onFocus={() => setFocusedField('phone')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Address *</Text>
                <TextInput
                  style={[
                    styles.input,
                    focusedField === 'address' && styles.inputFocused,
                    errors.address && styles.inputError,
                  ]}
                  value={billingInfo.address}
                  onChangeText={(v) => updateBillingField('address', v)}
                  placeholder="Street address"
                  placeholderTextColor={colors.grayLight}
                  onFocus={() => setFocusedField('address')}
                  onBlur={() => setFocusedField(null)}
                />
              </View>

              <View style={styles.nameRow}>
                <View style={[styles.inputGroup, styles.halfInput]}>
                  <Text style={styles.label}>City *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'city' && styles.inputFocused,
                      errors.city && styles.inputError,
                    ]}
                    value={billingInfo.city}
                    onChangeText={(v) => updateBillingField('city', v)}
                    placeholder="City"
                    placeholderTextColor={colors.grayLight}
                    onFocus={() => setFocusedField('city')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>

                <View style={[styles.inputGroup, styles.stateInput]}>
                  <Text style={styles.label}>State *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'state' && styles.inputFocused,
                      errors.state && styles.inputError,
                    ]}
                    value={billingInfo.state}
                    onChangeText={(v) => updateBillingField('state', v)}
                    placeholder="PA"
                    placeholderTextColor={colors.grayLight}
                    autoCapitalize="characters"
                    maxLength={2}
                    onFocus={() => setFocusedField('state')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>

                <View style={[styles.inputGroup, styles.zipInput]}>
                  <Text style={styles.label}>ZIP *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      focusedField === 'zipCode' && styles.inputFocused,
                      errors.zipCode && styles.inputError,
                    ]}
                    value={billingInfo.zipCode}
                    onChangeText={(v) => updateBillingField('zipCode', v)}
                    placeholder="12345"
                    placeholderTextColor={colors.grayLight}
                    keyboardType="numeric"
                    maxLength={10}
                    onFocus={() => setFocusedField('zipCode')}
                    onBlur={() => setFocusedField(null)}
                  />
                </View>
              </View>
            </Card>
          </View>

          {/* Payment Method */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Payment Method</Text>
            <Card style={styles.card}>
              <TouchableOpacity
                style={[
                  styles.paymentOption,
                  paymentMethod === 'card' && styles.paymentOptionSelected,
                ]}
                onPress={() => setPaymentMethod('card')}
              >
                <View style={styles.paymentRadio}>
                  {paymentMethod === 'card' && <View style={styles.paymentRadioInner} />}
                </View>
                <Text style={styles.paymentIcon}>💳</Text>
                <Text style={styles.paymentLabel}>Credit / Debit Card</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.paymentOption,
                  paymentMethod === 'paypal' && styles.paymentOptionSelected,
                ]}
                onPress={() => setPaymentMethod('paypal')}
              >
                <View style={styles.paymentRadio}>
                  {paymentMethod === 'paypal' && <View style={styles.paymentRadioInner} />}
                </View>
                <Text style={styles.paymentIcon}>🅿️</Text>
                <Text style={styles.paymentLabel}>PayPal</Text>
              </TouchableOpacity>

              <Text style={styles.paymentNote}>
                You will be redirected to complete payment securely.
              </Text>
            </Card>
          </View>

          {/* Terms */}
          <View style={styles.termsContainer}>
            <Text style={styles.termsText}>
              By placing this order, you agree to our{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://ptpsummercamps.com/terms')}
              >
                Terms of Service
              </Text>{' '}
              and{' '}
              <Text
                style={styles.termsLink}
                onPress={() => Linking.openURL('https://ptpsummercamps.com/refund-policy')}
              >
                Refund Policy
              </Text>
              .
            </Text>
          </View>
        </ScrollView>

        {/* Place Order Button */}
        <View style={styles.bottomContainer}>
          <PrimaryButton
            title={`Place Order • ${calculateTotal()}`}
            onPress={handlePlaceOrder}
            loading={orderMutation.isPending}
            disabled={orderMutation.isPending || cartItems.length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
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

  // Card
  card: {
    padding: spacing.lg,
  },

  // Order Summary
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  orderItemInfo: {
    flex: 1,
  },
  orderItemName: {
    fontSize: typography.sizes.md,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  orderItemQty: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  orderItemPrice: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  totalValue: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },

  // Input
  nameRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  halfInput: {
    flex: 1,
  },
  stateInput: {
    width: 70,
  },
  zipInput: {
    width: 100,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  input: {
    ...componentStyles.input,
  },
  inputFocused: {
    ...componentStyles.inputFocused,
  },
  inputError: {
    borderColor: colors.error,
  },

  // Payment
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  paymentOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(252, 185, 0, 0.05)',
  },
  paymentRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
  paymentIcon: {
    fontSize: 20,
    marginRight: spacing.sm,
  },
  paymentLabel: {
    fontSize: typography.sizes.md,
    color: colors.ink,
  },
  paymentNote: {
    fontSize: typography.sizes.xs,
    color: colors.grayLight,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Terms
  termsContainer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
  },
  termsText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    textAlign: 'center',
    lineHeight: 20,
  },
  termsLink: {
    color: colors.primary,
    textDecorationLine: 'underline',
  },

  // Bottom
  bottomContainer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
});

export default CheckoutScreen;
