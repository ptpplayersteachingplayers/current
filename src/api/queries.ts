import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Camp,
  Trainer,
  Session,
  AppConfig,
  ChildProfile,
  CreateChildProfileRequest,
  UpdateChildProfileRequest,
  Order,
  CampFilters,
} from '../types';
import {
  getCamps,
  getTrainers,
  getSessions,
  getAppConfig,
  getChildProfiles,
  getChildProfile,
  createChildProfile,
  updateChildProfile,
  deleteChildProfile,
  getOrders,
  getOrder,
  getCampsWithFilters,
} from './client';

// =============================================================================
// Camps Queries
// =============================================================================

export interface CampsQueryParams {
  lat?: number;
  lng?: number;
  radius?: number;
}

export const useCampsQuery = (params?: CampsQueryParams) =>
  useQuery<Camp[]>({
    queryKey: ['camps', params],
    queryFn: () => getCamps(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

export const useCampsWithFiltersQuery = (filters?: CampFilters) =>
  useQuery<Camp[]>({
    queryKey: ['camps', 'filtered', filters],
    queryFn: () => getCampsWithFilters(filters),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

// =============================================================================
// Trainers Query
// =============================================================================

export const useTrainersQuery = () =>
  useQuery<Trainer[]>({
    queryKey: ['trainers'],
    queryFn: getTrainers,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

// =============================================================================
// Sessions Query
// =============================================================================

export const useSessionsQuery = (enabled = true) =>
  useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: getSessions,
    staleTime: 30 * 1000, // schedule changes often
    refetchOnWindowFocus: true,
    enabled,
  });

// =============================================================================
// App Config Query
// =============================================================================

export const useAppConfigQuery = () =>
  useQuery<AppConfig>({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

// =============================================================================
// Child Profiles Queries & Mutations
// =============================================================================

export const useChildProfilesQuery = (enabled = true) =>
  useQuery<ChildProfile[]>({
    queryKey: ['children'],
    queryFn: getChildProfiles,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    enabled,
  });

export const useChildProfileQuery = (childId: number, enabled = true) =>
  useQuery<ChildProfile>({
    queryKey: ['children', childId],
    queryFn: () => getChildProfile(childId),
    staleTime: 5 * 60 * 1000,
    enabled: enabled && childId > 0,
  });

export const useCreateChildProfileMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateChildProfileRequest) => createChildProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
    },
  });
};

export const useUpdateChildProfileMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateChildProfileRequest) => updateChildProfile(data),
    onSuccess: (updatedChild) => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
      queryClient.setQueryData(['children', updatedChild.id], updatedChild);
    },
  });
};

export const useDeleteChildProfileMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (childId: number) => deleteChildProfile(childId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['children'] });
    },
  });
};

// =============================================================================
// Orders Queries
// =============================================================================

export const useOrdersQuery = (enabled = true) =>
  useQuery<Order[]>({
    queryKey: ['orders'],
    queryFn: getOrders,
    staleTime: 2 * 60 * 1000, // 2 minutes - orders can change
    refetchOnWindowFocus: true,
    enabled,
  });

export const useOrderQuery = (orderId: number, enabled = true) =>
  useQuery<Order>({
    queryKey: ['orders', orderId],
    queryFn: () => getOrder(orderId),
    staleTime: 2 * 60 * 1000,
    enabled: enabled && orderId > 0,
  });
