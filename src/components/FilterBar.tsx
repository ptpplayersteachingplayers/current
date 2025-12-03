/**
 * PTP Mobile App - Filter Bar Component
 *
 * Horizontal scrollable filter chips for camps/clinics filtering.
 * Supports category, state, and sort options.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, borderRadius } from '../theme';
import { CampFilters, CampCategory, StateCode } from '../types';

interface FilterBarProps {
  filters: CampFilters;
  onFiltersChange: (filters: CampFilters) => void;
  availableStates?: StateCode[];
}

const CATEGORIES: { value: CampCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All Programs' },
  { value: 'summer', label: 'Summer Camps' },
  { value: 'winter-clinics', label: 'Winter Clinics' },
];

const STATES: { value: StateCode | 'all'; label: string }[] = [
  { value: 'all', label: 'All States' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'DE', label: 'Delaware' },
  { value: 'MD', label: 'Maryland' },
  { value: 'NY', label: 'New York' },
];

const SORT_OPTIONS: { value: CampFilters['sortBy']; label: string }[] = [
  { value: 'date', label: 'Date' },
  { value: 'price', label: 'Price' },
  { value: 'name', label: 'Name' },
];

export const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onFiltersChange,
}) => {
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showStateModal, setShowStateModal] = useState(false);
  const [showSortModal, setShowSortModal] = useState(false);

  const activeFiltersCount = [
    filters.category && filters.category !== 'all',
    filters.state && filters.state !== 'all',
    filters.sortBy,
  ].filter(Boolean).length;

  const getCategoryLabel = () => {
    if (!filters.category || filters.category === 'all') return 'Category';
    return CATEGORIES.find((c) => c.value === filters.category)?.label ?? 'Category';
  };

  const getStateLabel = () => {
    if (!filters.state || filters.state === 'all') return 'State';
    return STATES.find((s) => s.value === filters.state)?.label ?? 'State';
  };

  const getSortLabel = () => {
    if (!filters.sortBy) return 'Sort';
    return `Sort: ${SORT_OPTIONS.find((s) => s.value === filters.sortBy)?.label}`;
  };

  const handleClearFilters = () => {
    onFiltersChange({
      category: 'all',
      state: 'all',
      sortBy: undefined,
      sortOrder: undefined,
    });
  };

  const renderFilterChip = (
    label: string,
    isActive: boolean,
    onPress: () => void,
    icon?: string
  ) => (
    <TouchableOpacity
      style={[styles.filterChip, isActive && styles.filterChipActive]}
      onPress={onPress}
    >
      {icon && (
        <Ionicons
          name={icon as any}
          size={14}
          color={isActive ? colors.ink : colors.gray}
          style={styles.chipIcon}
        />
      )}
      <Text
        style={[styles.filterChipText, isActive && styles.filterChipTextActive]}
      >
        {label}
      </Text>
      <Ionicons
        name="chevron-down"
        size={14}
        color={isActive ? colors.ink : colors.gray}
      />
    </TouchableOpacity>
  );

  const renderSelectModal = (
    visible: boolean,
    onClose: () => void,
    title: string,
    options: { value: string; label: string }[],
    selectedValue: string | undefined,
    onSelect: (value: string) => void
  ) => (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{title}</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={24} color={colors.ink} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={options}
          keyExtractor={(item) => item.value}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.modalOption,
                selectedValue === item.value && styles.modalOptionSelected,
              ]}
              onPress={() => {
                onSelect(item.value);
                onClose();
              }}
            >
              <Text
                style={[
                  styles.modalOptionText,
                  selectedValue === item.value &&
                    styles.modalOptionTextSelected,
                ]}
              >
                {item.label}
              </Text>
              {selectedValue === item.value && (
                <Ionicons name="checkmark" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.modalContent}
        />
      </SafeAreaView>
    </Modal>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Category Filter */}
        {renderFilterChip(
          getCategoryLabel(),
          filters.category !== undefined && filters.category !== 'all',
          () => setShowCategoryModal(true),
          'football-outline'
        )}

        {/* State Filter */}
        {renderFilterChip(
          getStateLabel(),
          filters.state !== undefined && filters.state !== 'all',
          () => setShowStateModal(true),
          'location-outline'
        )}

        {/* Sort */}
        {renderFilterChip(
          getSortLabel(),
          filters.sortBy !== undefined,
          () => setShowSortModal(true),
          'swap-vertical-outline'
        )}

        {/* Clear Filters */}
        {activeFiltersCount > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={handleClearFilters}
          >
            <Ionicons name="close-circle" size={16} color={colors.error} />
            <Text style={styles.clearButtonText}>Clear</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Category Modal */}
      {renderSelectModal(
        showCategoryModal,
        () => setShowCategoryModal(false),
        'Select Category',
        CATEGORIES,
        filters.category || 'all',
        (value) =>
          onFiltersChange({
            ...filters,
            category: value as CampCategory | 'all',
          })
      )}

      {/* State Modal */}
      {renderSelectModal(
        showStateModal,
        () => setShowStateModal(false),
        'Select State',
        STATES,
        filters.state || 'all',
        (value) =>
          onFiltersChange({ ...filters, state: value as StateCode | 'all' })
      )}

      {/* Sort Modal */}
      {renderSelectModal(
        showSortModal,
        () => setShowSortModal(false),
        'Sort By',
        SORT_OPTIONS.map((o) => ({ value: o.value ?? '', label: o.label })),
        filters.sortBy || '',
        (value) =>
          onFiltersChange({
            ...filters,
            sortBy: value as CampFilters['sortBy'],
            sortOrder: 'asc',
          })
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Filter Chip
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    marginRight: spacing.sm,
  },
  filterChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  chipIcon: {
    marginRight: spacing.xs,
  },
  filterChipText: {
    fontSize: typography.sizes.sm,
    color: colors.gray,
    marginRight: spacing.xs,
  },
  filterChipTextActive: {
    color: colors.ink,
    fontWeight: typography.weights.medium,
  },

  // Clear Button
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  clearButtonText: {
    fontSize: typography.sizes.sm,
    color: colors.error,
    marginLeft: spacing.xs,
  },

  // Modal
  modalContainer: {
    flex: 1,
    backgroundColor: colors.white,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: typography.sizes.lg,
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
  closeButton: {
    padding: spacing.sm,
  },
  modalContent: {
    paddingVertical: spacing.md,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionSelected: {
    backgroundColor: colors.primary + '10',
  },
  modalOptionText: {
    fontSize: typography.sizes.md,
    color: colors.ink,
  },
  modalOptionTextSelected: {
    fontWeight: typography.weights.semibold,
    color: colors.ink,
  },
});

export default FilterBar;
