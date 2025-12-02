/**
 * PTP Mobile App - Orders Screen
 *
 * Features:
 * - View order history
 * - Order status
 * - Order details
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Card, LoadingScreen, EmptyState, ErrorState, Badge } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { ProfileStackParamList, Order } from '../types';
import { getOrders } from '../api/client';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Orders'>;

const OrdersScreen: React.FC<Props> = ({ navigation }) => {
  const { user, isGuest } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: orders = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['orders'],
    queryFn: getOrders,
    enabled: !!user && !isGuest,
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

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
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Guest view
  if (isGuest || !user) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="📋"
          title="Sign In to View Orders"
          message="Please sign in to view your order history and registrations."
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return <LoadingScreen message="Loading orders..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Unable to load your orders"
        onRetry={refetch}
      />
    );
  }

  if (orders.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="📋"
          title="No Orders Yet"
          message="When you register for camps or training, your orders will appear here."
        />
      </SafeAreaView>
    );
  }

  const renderOrder = ({ item }: { item: Order }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => navigation.navigate('OrderDetail', { order: item })}
    >
      <Card style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View>
            <Text style={styles.orderNumber}>Order #{item.orderNumber}</Text>
            <Text style={styles.orderDate}>{formatDate(item.date)}</Text>
          </View>
          {getStatusBadge(item.status)}
        </View>

        <View style={styles.orderItems}>
          {item.items.slice(0, 2).map((orderItem, index) => (
            <Text key={index} style={styles.orderItemText} numberOfLines={1}>
              • {orderItem.name} {orderItem.quantity > 1 ? `(x${orderItem.quantity})` : ''}
            </Text>
          ))}
          {item.items.length > 2 && (
            <Text style={styles.moreItems}>
              +{item.items.length - 2} more item{item.items.length - 2 > 1 ? 's' : ''}
            </Text>
          )}
        </View>

        <View style={styles.orderFooter}>
          <Text style={styles.orderTotal}>{item.total}</Text>
          <Text style={styles.viewDetails}>View Details →</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <FlatList
        data={orders}
        renderItem={renderOrder}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Your Orders</Text>
            <Text style={styles.headerSubtitle}>
              {orders.length} order{orders.length !== 1 ? 's' : ''}
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

  // Header
  header: {
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: typography.sizes.xxl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },

  // Order Card
  orderCard: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  orderNumber: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  orderDate: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },

  // Order Items
  orderItems: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  orderItemText: {
    fontSize: typography.sizes.sm,
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  moreItems: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    fontStyle: 'italic',
  },

  // Order Footer
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
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
    fontSize: typography.sizes.sm,
    color: colors.primary,
    fontWeight: typography.weights.medium,
  },
});

export default OrdersScreen;
