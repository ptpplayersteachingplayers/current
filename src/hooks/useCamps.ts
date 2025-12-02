/**
 * PTP Mobile App - useCamps Hook
 *
 * Specialized hook for fetching camps data
 */

import { getCamps } from '../api/client';
import { Camp } from '../types';
import { useApi } from './useApi';

interface UseCampsReturn {
  camps: Camp[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching camps and clinics
 *
 * @example
 * ```tsx
 * const { camps, isLoading, error, refresh } = useCamps();
 * ```
 */
export function useCamps(): UseCampsReturn {
  const { data, isLoading, isRefreshing, error, refetch, refresh } = useApi(getCamps);

  return {
    camps: data ?? [],
    isLoading,
    isRefreshing,
    error,
    refetch,
    refresh,
  };
}

export default useCamps;
