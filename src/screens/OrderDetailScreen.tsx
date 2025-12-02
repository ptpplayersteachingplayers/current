/**
 * PTP Mobile App - Order Detail Screen
 *
 * Features:
 * - Full order information
 * - Item details
 * - Billing information
 * - Contact support
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Card, Badge, PrimaryButton } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { ProfileStackParamList } from '../types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'OrderDetail'>;

const OrderDetailScreen: React.FC<Props> = ({ route }) => {
  const { order } = route.params;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge label="Completed" variant="bestseller" />;
      case 'processing':
        return <Badge label="Processing" variant="info" />;
      case 'pending':
        return <Badge label="Pending Payment" variant="almostFull" />;
      case 'cancelled':
        return <Badge label="Cancelled" variant="almostFull" />;
      case 'refunded':
        return <Badge label="Refunded" variant="info" />;
      default:
        return <Badge label={status} variant="info" />;
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleContactSupport = () => {
    Linking.openURL(
      `mailto:info@ptpsummercamps.com?subject=Question about Order #${order.orderNumber}`
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Order Header */}
        <View style={styles.header}>
          <Text style={styles.orderNumber}>Order #{order.orderNumber}</Text>
          <Text style={styles.orderDate}>{formatDate(order.date)}</Text>
          <View style={styles.statusContainer}>
            {getStatusBadge(order.status)}
          </View>
        </View>

        {/* Order Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          <Card style={styles.card}>
            {order.items.map((item, index) => (
              <View
                key={index}
                style={[
                  styles.itemRow,
                  index < order.items.length - 1 && styles.itemRowBorder,
                ]}
              >
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.date && (
                    <Text style={styles.itemMeta}>{item.date}</Text>
                  )}
                  {item.location && (
                    <Text style={styles.itemMeta}>{item.location}</Text>
                  )}
                  <Text style={styles.itemQty}>Quantity: {item.quantity}</Text>
                </View>
                <Text style={styles.itemPrice}>{item.price}</Text>
              </View>
            ))}
          </Card>
        </View>

        {/* Order Summary */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Summary</Text>
          <Card style={styles.card}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{order.subtotal || order.total}</Text>
            </View>
            {order.discount && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Discount</Text>
                <Text style={[styles.summaryValue, styles.discountValue]}>
                  -{order.discount}
                </Text>
              </View>
            )}
            {order.tax && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tax</Text>
                <Text style={styles.summaryValue}>{order.tax}</Text>
              </View>
            )}
            <View style={[styles.summaryRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{order.total}</Text>
            </View>
          </Card>
        </View>

        {/* Billing Information */}
        {order.billing && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Billing Information</Text>
            <Card style={styles.card}>
              <Text style={styles.billingName}>
                {order.billing.firstName} {order.billing.lastName}
              </Text>
              <Text style={styles.billingText}>{order.billing.email}</Text>
              {order.billing.phone && (
                <Text style={styles.billingText}>{order.billing.phone}</Text>
              )}
              {order.billing.address && (
                <>
                  <View style={styles.billingDivider} />
                  <Text style={styles.billingText}>{order.billing.address}</Text>
                  <Text style={styles.billingText}>
                    {order.billing.city}, {order.billing.state} {order.billing.zipCode}
                  </Text>
                </>
              )}
            </Card>
          </View>
        )}

        {/* Payment Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <Card style={styles.card}>
            <View style={styles.paymentRow}>
              <Text style={styles.paymentLabel}>Method</Text>
              <Text style={styles.paymentValue}>
                {order.paymentMethod === 'card' ? '💳 Credit Card' : '🅿️ PayPal'}
              </Text>
            </View>
            {order.transactionId && (
              <View style={styles.paymentRow}>
                <Text style={styles.paymentLabel}>Transaction ID</Text>
                <Text style={styles.paymentValue}>{order.transactionId}</Text>
              </View>
            )}
          </Card>
        </View>

        {/* Help Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Need Help?</Text>
          <Card style={styles.card}>
            <Text style={styles.helpText}>
              If you have any questions about your order or need to make changes,
              please contact our support team.
            </Text>
            <PrimaryButton
              title="Contact Support"
              onPress={handleContactSupport}
              variant="outline"
              style={styles.supportButton}
            />
          </Card>
        </View>

        {/* Refund Policy */}
        <TouchableOpacity
          style={styles.policyLink}
          onPress={() => Linking.openURL('https://ptpsummercamps.com/refund-policy')}
        >
          <Text style={styles.policyText}>View Refund Policy</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

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

  // Header
  header: {
    backgroundColor: colors.white,
    padding: spacing.xl,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  orderNumber: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  orderDate: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    marginBottom: spacing.md,
  },
  statusContainer: {
    marginTop: spacing.sm,
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

  // Items
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  itemRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  itemName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  itemMeta: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.xs,
  },
  itemQty: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  itemPrice: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  summaryLabel: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },
  summaryValue: {
    fontSize: typography.sizes.md,
    color: colors.ink,
  },
  discountValue: {
    color: colors.success,
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
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

  // Billing
  billingName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  billingText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: spacing.xs,
  },
  billingDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },

  // Payment
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  paymentLabel: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },
  paymentValue: {
    fontSize: typography.sizes.md,
    color: colors.ink,
  },

  // Help
  helpText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  supportButton: {
    marginTop: spacing.sm,
  },

  // Policy
  policyLink: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  policyText: {
    fontSize: typography.sizes.sm,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
});

export default OrderDetailScreen;
