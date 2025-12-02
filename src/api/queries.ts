import { useQuery } from '@tanstack/react-query';
import { Camp, Trainer, Session, AppConfig } from '../types';
import { getCamps, getTrainers, getSessions, getAppConfig } from './client';

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

export const useTrainersQuery = () =>
  useQuery<Trainer[]>({
    queryKey: ['trainers'],
    queryFn: getTrainers,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

export const useSessionsQuery = (enabled = true) =>
  useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: getSessions,
    staleTime: 30 * 1000, // schedule changes often
    refetchOnWindowFocus: true,
    enabled,
  });

export const useAppConfigQuery = () =>
  useQuery<AppConfig>({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
