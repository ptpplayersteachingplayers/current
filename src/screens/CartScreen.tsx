/**
 * PTP Mobile App - Cart Screen
 *
 * Features:
 * - View cart items
 * - Update quantities
 * - Remove items
 * - Proceed to checkout
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PrimaryButton, Card, LoadingScreen, EmptyState, ErrorState } from '../components';
import { colors, spacing, typography, borderRadius } from '../theme';
import { CampsStackParamList, CartItem } from '../types';
import { getCart, updateCartItem, removeCartItem } from '../api/client';
import { useAuth } from '../context/AuthContext';

type Props = NativeStackScreenProps<CampsStackParamList, 'Cart'>;

const CartScreen: React.FC<Props> = ({ navigation }) => {
  const { user, isGuest } = useAuth();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const {
    data: cartItems = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['cart'],
    queryFn: getCart,
    enabled: !!user && !isGuest,
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      updateCartItem(itemId, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: number) => removeCartItem(itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleRemoveItem = (item: CartItem) => {
    Alert.alert(
      'Remove Item',
      `Are you sure you want to remove "${item.name}" from your cart?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate(item.id),
        },
      ]
    );
  };

  const handleCheckout = () => {
    navigation.navigate('Checkout');
  };

  const calculateTotal = (): string => {
    const total = cartItems.reduce((sum, item) => {
      const price = parseFloat(item.price.replace(/[^0-9.]/g, ''));
      return sum + price * item.quantity;
    }, 0);
    return `$${total.toFixed(2)}`;
  };

  // Guest view
  if (isGuest || !user) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="🛒"
          title="Sign In to View Cart"
          message="Please sign in to add camps to your cart and complete registration."
        />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return <LoadingScreen message="Loading cart..." />;
  }

  if (error) {
    return (
      <ErrorState
        message="Unable to load your cart"
        onRetry={refetch}
      />
    );
  }

  if (cartItems.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['left', 'right']}>
        <EmptyState
          icon="🛒"
          title="Your Cart is Empty"
          message="Browse our camps and clinics to find the perfect training experience."
        />
        <View style={styles.emptyAction}>
          <PrimaryButton
            title="Browse Camps"
            onPress={() => navigation.navigate('Camps')}
          />
        </View>
      </SafeAreaView>
    );
  }

  const renderCartItem = ({ item }: { item: CartItem }) => (
    <Card style={styles.cartItem}>
      <View style={styles.itemRow}>
        {item.image ? (
          <Image source={{ uri: item.image }} style={styles.itemImage} />
        ) : (
          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
            <Text style={styles.placeholderText}>PTP</Text>
          </View>
        )}

        <View style={styles.itemDetails}>
          <Text style={styles.itemName} numberOfLines={2}>
            {item.name}
          </Text>
          {item.date && (
            <Text style={styles.itemMeta}>{item.date}</Text>
          )}
          <Text style={styles.itemPrice}>{item.price}</Text>
        </View>

        <TouchableOpacity
          style={styles.removeButton}
          onPress={() => handleRemoveItem(item)}
        >
          <Text style={styles.removeIcon}>×</Text>
        </TouchableOpacity>
      </View>

      {/* Quantity Controls */}
      <View style={styles.quantityRow}>
        <Text style={styles.quantityLabel}>Quantity:</Text>
        <View style={styles.quantityControls}>
          <TouchableOpacity
            style={[
              styles.quantityButton,
              item.quantity <= 1 && styles.quantityButtonDisabled,
            ]}
            onPress={() => {
              if (item.quantity > 1) {
                updateMutation.mutate({ itemId: item.id, quantity: item.quantity - 1 });
              }
            }}
            disabled={item.quantity <= 1}
          >
            <Text style={styles.quantityButtonText}>−</Text>
          </TouchableOpacity>

          <Text style={styles.quantityValue}>{item.quantity}</Text>

          <TouchableOpacity
            style={styles.quantityButton}
            onPress={() => {
              updateMutation.mutate({ itemId: item.id, quantity: item.quantity + 1 });
            }}
          >
            <Text style={styles.quantityButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Card>
  );

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <FlatList
        data={cartItems}
        renderItem={renderCartItem}
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
        ListFooterComponent={
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>{calculateTotal()}</Text>
            </View>
            <Text style={styles.taxNote}>
              Taxes and fees calculated at checkout
            </Text>
          </View>
        }
      />

      {/* Checkout Button */}
      <View style={styles.checkoutContainer}>
        <View style={styles.checkoutTotal}>
          <Text style={styles.checkoutTotalLabel}>Total</Text>
          <Text style={styles.checkoutTotalValue}>{calculateTotal()}</Text>
        </View>
        <PrimaryButton
          title="Proceed to Checkout"
          onPress={handleCheckout}
          style={styles.checkoutButton}
        />
      </View>
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
    paddingBottom: 180,
  },

  // Cart Item
  cartItem: {
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  itemImage: {
    width: 70,
    height: 70,
    borderRadius: borderRadius.md,
    backgroundColor: colors.border,
  },
  itemImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  placeholderText: {
    color: colors.primary,
    fontWeight: typography.weights.bold,
    fontSize: typography.sizes.sm,
  },
  itemDetails: {
    flex: 1,
    marginLeft: spacing.md,
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
  itemPrice: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.bold,
    color: colors.primary,
  },
  removeButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  removeIcon: {
    fontSize: 24,
    color: colors.gray,
    fontWeight: typography.weights.bold,
  },

  // Quantity
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  quantityLabel: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
  },
  quantityControls: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  quantityButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.offWhite,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  quantityButtonDisabled: {
    opacity: 0.5,
  },
  quantityButtonText: {
    fontSize: 20,
    color: colors.ink,
    fontWeight: typography.weights.medium,
  },
  quantityValue: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
    marginHorizontal: spacing.lg,
    minWidth: 24,
    textAlign: 'center',
  },

  // Summary
  summary: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryLabel: {
    fontSize: typography.sizes.md,
    color: colors.gray,
  },
  summaryValue: {
    fontSize: typography.sizes.md,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  taxNote: {
    fontSize: typography.sizes.xs,
    color: colors.grayLight,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  // Checkout
  checkoutContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  checkoutTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  checkoutTotalLabel: {
    fontSize: typography.sizes.lg,
    color: colors.ink,
  },
  checkoutTotalValue: {
    fontSize: typography.sizes.xl,
    fontWeight: typography.weights.bold,
    color: colors.ink,
  },
  checkoutButton: {},

  // Empty State
  emptyAction: {
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
});

export default CartScreen;
