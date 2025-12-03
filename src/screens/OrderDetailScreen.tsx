/**
 * PTP Mobile App - Order Detail Screen
 *
 * Displays full order details including line items, event info, and billing.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Badge } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { ProfileStackParamList, OrderStatus } from '../types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'OrderDetail'>;

const OrderDetailScreen: React.FC<Props> = ({ route }) => {
  const { order } = route.params;

  const getStatusBadgeVariant = (
    status: OrderStatus
  ): 'success' | 'warning' | 'info' | 'error' => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'processing':
      case 'on-hold':
        return 'info';
      case 'pending':
        return 'warning';
      case 'cancelled':
      case 'refunded':
      case 'failed':
        return 'error';
      default:
        return 'info';
    }
  };

  const getStatusLabel = (status: OrderStatus): string => {
    switch (status) {
      case 'completed':
        return 'Completed';
      case 'processing':
        return 'Processing';
      case 'on-hold':
        return 'On Hold';
      case 'pending':
        return 'Pending Payment';
      case 'cancelled':
        return 'Cancelled';
      case 'refunded':
        return 'Refunded';
      case 'failed':
        return 'Failed';
      default:
        return status;
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Order Header */}
        <View style={styles.headerCard}>
          <View style={styles.orderIdRow}>
            <Text style={styles.orderLabel}>Order</Text>
            <Text style={styles.orderId}>#{order.order_number}</Text>
          </View>
          <Badge
            label={getStatusLabel(order.status)}
            variant={getStatusBadgeVariant(order.status)}
            style={styles.statusBadge}
          />
          <Text style={styles.orderDate}>{formatDate(order.date_created)}</Text>
        </View>

        {/* Line Items */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items</Text>
          {order.line_items.map((item, index) => (
            <View key={item.id || index} style={styles.lineItemCard}>
              <View style={styles.lineItemHeader}>
                <Text style={styles.lineItemName}>{item.name}</Text>
                <Text style={styles.lineItemTotal}>{item.total}</Text>
              </View>

              <View style={styles.lineItemDetails}>
                <View style={styles.detailRow}>
                  <Ionicons
                    name="pricetag-outline"
                    size={14}
                    color={colors.gray}
                  />
                  <Text style={styles.detailText}>Qty: {item.quantity}</Text>
                </View>

                {item.child_name && (
                  <View style={styles.detailRow}>
                    <Ionicons
                      name="person-outline"
                      size={14}
                      color={colors.gray}
                    />
                    <Text style={styles.detailText}>{item.child_name}</Text>
                  </View>
                )}

                {item.event_date && (
                  <View style={styles.detailRow}>
                    <Ionicons
                      name="calendar-outline"
                      size={14}
                      color={colors.gray}
                    />
                    <Text style={styles.detailText}>{item.event_date}</Text>
                  </View>
                )}

                {item.event_time && (
                  <View style={styles.detailRow}>
                    <Ionicons
                      name="time-outline"
                      size={14}
                      color={colors.gray}
                    />
                    <Text style={styles.detailText}>{item.event_time}</Text>
                  </View>
                )}

                {item.event_location && (
                  <View style={styles.detailRow}>
                    <Ionicons
                      name="location-outline"
                      size={14}
                      color={colors.gray}
                    />
                    <Text style={styles.detailText}>{item.event_location}</Text>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>

        {/* Order Total */}
        <View style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Order Total</Text>
            <Text style={styles.totalAmount}>{order.total}</Text>
          </View>
          {order.date_paid && (
            <Text style={styles.paidDate}>
              Paid on {formatDate(order.date_paid)}
            </Text>
          )}
        </View>

        {/* Billing Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Billing Information</Text>
          <View style={styles.billingCard}>
            <Text style={styles.billingName}>
              {order.billing.first_name} {order.billing.last_name}
            </Text>
            <Text style={styles.billingDetail}>{order.billing.email}</Text>
            {order.billing.phone && (
              <Text style={styles.billingDetail}>{order.billing.phone}</Text>
            )}
          </View>
        </View>

        {/* Help Section */}
        <View style={styles.helpSection}>
          <Ionicons
            name="help-circle-outline"
            size={20}
            color={colors.gray}
          />
          <Text style={styles.helpText}>
            Questions about this order? Contact us at{' '}
            <Text style={styles.helpLink}>info@ptpsummercamps.com</Text>
          </Text>
        </View>
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
    padding: spacing.lg,
  },

  // Header Card
  headerCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  orderIdRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  orderLabel: {
    fontSize: typography.sizes.md,
    color: colors.gray,
    marginRight: spacing.xs,
  },
  orderId: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  statusBadge: {
    marginBottom: spacing.sm,
  },
  orderDate: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },

  // Section
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.md,
  },

  // Line Item Card
  lineItemCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lineItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  lineItemName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    flex: 1,
    marginRight: spacing.md,
  },
  lineItemTotal: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  lineItemDetails: {
    backgroundColor: colors.offWhite,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  detailText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginLeft: spacing.sm,
  },

  // Total Card
  totalCard: {
    backgroundColor: colors.ink,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: typography.sizes.md,
    color: colors.white,
  },
  totalAmount: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  paidDate: {
    fontSize: typography.sizes.xs,
    color: colors.grayLight,
    marginTop: spacing.sm,
  },

  // Billing Card
  billingCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  billingName: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  billingDetail: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginBottom: 2,
  },

  // Help Section
  helpSection: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginLeft: spacing.sm,
    flex: 1,
    lineHeight: typography.sizes.sm * typography.lineHeights.normal,
  },
  helpLink: {
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },
});

export default OrderDetailScreen;
