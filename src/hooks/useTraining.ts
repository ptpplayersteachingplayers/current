/**
 * React Query hooks for the training side.
 *
 * Slot data is deliberately short-lived: availability changes as other parents
 * book, so a stale slot list produces a "that time has gone" error at the worst
 * possible moment. Caching identity and schedule data longer is fine.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  addAvailability,
  cancelBooking,
  completeSession,
  getMyAvailability,
  getMyBookings,
  getMyPlayers,
  getTrainer,
  getTrainerEarnings,
  getTrainerSchedule,
  getTrainerSlots,
  getTrainers,
  holdSlot,
} from '../api/training';

export const trainingKeys = {
  trainers: ['training', 'trainers'] as const,
  trainer: (id: number) => ['training', 'trainer', id] as const,
  slots: (id: number) => ['training', 'slots', id] as const,
  players: ['training', 'players'] as const,
  bookings: ['training', 'bookings'] as const,
  schedule: ['training', 'schedule'] as const,
  earnings: ['training', 'earnings'] as const,
  availability: ['training', 'availability'] as const,
};

// =============================================================================
// Parent
// =============================================================================

export const useTrainers = () =>
  useQuery({
    queryKey: trainingKeys.trainers,
    queryFn: () => getTrainers(),
    staleTime: 5 * 60 * 1000,
  });

export const useTrainer = (id: number) =>
  useQuery({
    queryKey: trainingKeys.trainer(id),
    queryFn: () => getTrainer(id),
    enabled: id > 0,
    staleTime: 5 * 60 * 1000,
  });

/**
 * Availability for a trainer.
 *
 * 30s stale time and a refetch on focus: someone else may have taken the slot
 * while the parent was deciding, and finding out here beats finding out after
 * they have chosen.
 */
export const useTrainerSlots = (id: number) =>
  useQuery({
    queryKey: trainingKeys.slots(id),
    queryFn: () => getTrainerSlots(id),
    enabled: id > 0,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

export const useMyPlayers = () =>
  useQuery({ queryKey: trainingKeys.players, queryFn: getMyPlayers });

export const useMyBookings = () =>
  useQuery({ queryKey: trainingKeys.bookings, queryFn: getMyBookings });

/**
 * Hold a slot ahead of checkout.
 *
 * On failure — usually a 409 because the slot went — the slot list for that
 * trainer is invalidated so the UI reflects reality on the next render.
 */
export const useHoldSlot = (trainerId: number) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: { startsAt: string; playerId: number }) =>
      holdSlot(trainerId, vars.startsAt, vars.playerId),
    onError: () => {
      queryClient.invalidateQueries({ queryKey: trainingKeys.slots(trainerId) });
    },
  });
};

export const useCancelBooking = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelBooking,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trainingKeys.bookings });
    },
  });
};

// =============================================================================
// Trainer
// =============================================================================

export const useTrainerSchedule = () =>
  useQuery({ queryKey: trainingKeys.schedule, queryFn: getTrainerSchedule });

export const useTrainerEarnings = () =>
  useQuery({ queryKey: trainingKeys.earnings, queryFn: getTrainerEarnings });

export const useMyAvailability = () =>
  useQuery({ queryKey: trainingKeys.availability, queryFn: getMyAvailability });

export const useAddAvailability = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addAvailability,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trainingKeys.availability });
    },
  });
};

/** Completing a session moves money, so refresh earnings as well as the list. */
export const useCompleteSession = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: trainingKeys.schedule });
      queryClient.invalidateQueries({ queryKey: trainingKeys.earnings });
    },
  });
};
