/**
 * PTP Mobile App - Orders Screen
 *
 * Displays order history from WooCommerce with order details.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useOrdersQuery } from '../api/queries';
import { useAuth } from '../context/AuthContext';
import { Card, LoadingScreen, ErrorState, EmptyState, Badge } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { Order, ProfileStackParamList, OrderStatus } from '../types';

type Props = NativeStackScreenProps<ProfileStackParamList, 'OrderHistory'>;

const OrdersScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();

  const {
    data: orders = [],
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useOrdersQuery(Boolean(user));

  const typedError = useMemo(() => {
    if (error && error instanceof Error) return error;
    return null;
  }, [error]);

  const errorMessage =
    typedError?.message || 'Failed to load orders. Please try again.';

  const handleOrderPress = (order: Order) => {
    navigation.navigate('OrderDetail', { order });
  };

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
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateString;
    }
  };

  const renderOrderCard = ({ item }: { item: Order }) => (
    <TouchableOpacity onPress={() => handleOrderPress(item)}>
      <Card style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View>
            <Text style={styles.orderNumber}>Order #{item.order_number}</Text>
            <Text style={styles.orderDate}>{formatDate(item.date_created)}</Text>
          </View>
          <Badge
            label={getStatusLabel(item.status)}
            variant={getStatusBadgeVariant(item.status)}
          />
        </View>

        <View style={styles.divider} />

        <View style={styles.orderItems}>
          {item.line_items.slice(0, 3).map((lineItem, index) => (
            <View key={lineItem.id || index} style={styles.lineItem}>
              <View style={styles.lineItemInfo}>
                <Text style={styles.lineItemName} numberOfLines={1}>
                  {lineItem.name}
                </Text>
                {lineItem.child_name && (
                  <Text style={styles.lineItemChild}>
                    For: {lineItem.child_name}
                  </Text>
                )}
              </View>
              <Text style={styles.lineItemQuantity}>x{lineItem.quantity}</Text>
            </View>
          ))}
          {item.line_items.length > 3 && (
            <Text style={styles.moreItems}>
              +{item.line_items.length - 3} more item(s)
            </Text>
          )}
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.orderTotal}>{item.total}</Text>
          <View style={styles.viewDetails}>
            <Text style={styles.viewDetailsText}>View Details</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );

  if (isLoading && !isRefetching) {
    return <LoadingScreen message="Loading orders..." />;
  }

  if (isError && orders.length === 0) {
    return <ErrorState message={errorMessage} onRetry={() => refetch()} />;
  }

  if (!isLoading && orders.length === 0) {
    return (
      <EmptyState
        title="No Orders Yet"
        message="Your order history will appear here once you register for camps or clinics."
        iconName="receipt-outline"
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderOrderCard}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View style={styles.headerContainer}>
            <Text style={styles.headerTitle}>Order History</Text>
            <Text style={styles.headerSubtitle}>
              {orders.length} {orders.length === 1 ? 'order' : 'orders'}
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.offWhite,
  },
  listContent: {
    padding: spacing.lg,
  },
  separator: {
    height: spacing.md,
  },
  headerContainer: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  headerSubtitle: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginTop: spacing.xs,
  },

  // Order Card
  orderCard: {
    padding: spacing.lg,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderNumber: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  orderDate: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginTop: 2,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },

  // Line Items
  orderItems: {
    marginBottom: spacing.md,
  },
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  lineItemInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  lineItemName: {
    fontSize: typography.sizes.sm,
    color: colors.ink,
  },
  lineItemChild: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    marginTop: 2,
  },
  lineItemQuantity: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  moreItems: {
    fontSize: typography.sizes.xs,
    color: colors.gray,
    fontStyle: 'italic',
  },

  // Footer
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  orderTotal: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  viewDetails: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewDetailsText: {
    fontSize: typography.sizes.sm,
    fontWeight: typography.weights.medium,
    color: colors.primary,
    marginRight: spacing.xs,
  },
});

export default OrdersScreen;
