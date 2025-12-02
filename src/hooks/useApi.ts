/**
 * PTP Mobile App - useApi Hook
 *
 * A generic hook for API data fetching with:
 * - Loading state management
 * - Error handling
 * - Automatic refetch capability
 * - Session expiry handling
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiClientError } from '../api/client';
import { useAuth } from '../context/AuthContext';

interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
}

interface UseApiReturn<T> extends UseApiState<T> {
  refetch: () => Promise<void>;
  refresh: () => Promise<void>;
}

interface UseApiOptions {
  /**
   * Whether to fetch data immediately on mount
   * @default true
   */
  immediate?: boolean;

  /**
   * Dependencies that trigger a refetch when changed
   */
  deps?: unknown[];
}

/**
 * Generic hook for API data fetching
 *
 * @param fetcher - Async function that returns the data
 * @param options - Configuration options
 * @returns Object with data, loading state, error, and refetch functions
 *
 * @example
 * ```tsx
 * const { data: camps, isLoading, error, refetch } = useApi(getCamps);
 *
 * if (isLoading) return <LoadingScreen />;
 * if (error) return <ErrorState message={error} onRetry={refetch} />;
 * return <CampsList camps={camps} />;
 * ```
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  options: UseApiOptions = {}
): UseApiReturn<T> {
  const { immediate = true, deps = [] } = options;
  const { logout } = useAuth();

  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    isLoading: immediate,
    isRefreshing: false,
    error: null,
  });

  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      if (!isMounted.current) return;

      setState((prev) => ({
        ...prev,
        isLoading: !isRefresh,
        isRefreshing: isRefresh,
        error: null,
      }));

      try {
        const data = await fetcher();

        if (!isMounted.current) return;

        setState({
          data,
          isLoading: false,
          isRefreshing: false,
          error: null,
        });
      } catch (err) {
        if (!isMounted.current) return;

        // Handle session expiry
        if (err instanceof ApiClientError && err.isSessionExpired()) {
          await logout();
          return;
        }

        const errorMessage =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred. Please try again.';

        setState((prev) => ({
          ...prev,
          isLoading: false,
          isRefreshing: false,
          error: errorMessage,
        }));
      }
    },
    [fetcher, logout]
  );

  // Initial fetch and refetch on dependency changes
  useEffect(() => {
    if (immediate) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [immediate, ...deps]);

  const refetch = useCallback(() => fetchData(false), [fetchData]);
  const refresh = useCallback(() => fetchData(true), [fetchData]);

  return {
    ...state,
    refetch,
    refresh,
  };
}

export default useApi;
