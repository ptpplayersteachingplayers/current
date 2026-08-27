/**
 * Training API — the ptp/v2 surface served by PTP Core.
 *
 * -----------------------------------------------------------------------------
 * This module talks to the rebuilt WordPress platform (`ptp/v2`) rather than the
 * legacy `ptp/v1` endpoints in `client.ts`. Both can run side by side during the
 * migration; screens move over one at a time.
 *
 * The important property: booking is a two-step handshake and the app never
 * computes or sends a price.
 *
 *   1. holdSlot() sends {trainerId, startsAt, playerId} and gets back a
 *      checkout URL. The server validates the slot against the trainer's real
 *      availability, holds it, and derives the price itself.
 *   2. The app opens that URL, so payment runs through the same checkout as the
 *      website — one payment path, not a mobile-specific one.
 *
 * That second point matters: two of the payment-bypass bugs found in the old
 * platform existed because mobile had its own order-completion endpoint.
 * -----------------------------------------------------------------------------
 */

import apiClient from './client';

// =============================================================================
// Types
// =============================================================================

export interface TrainerSummary {
  id: number;
  name: string;
  slug: string;
  hourlyCents: number;
}

export interface TrainerDetail extends TrainerSummary {
  bio: string;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  minutes: number;
  location: string;
}

export interface SlotDay {
  date: string;
  slots: Slot[];
}

export interface BookingSummary {
  id: number;
  type: 'training' | 'camp' | 'clinic';
  startsAt: string;
  endsAt: string | null;
  location: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  playerId: number | null;
}

export interface PlayerSummary {
  id: number;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  position: string;
}

export interface TrainerEarnings {
  pendingCents: number;
  clearingCents: number;
  paidCents: number;
  connected: boolean;
  /** What this trainer earns per session (or per hour), assigned by staff. */
  rateCents: number;
  rateBasis: 'session' | 'hour';
}

export interface AvailabilityRule {
  id: number;
  weekday: number;
  startsTime: string;
  endsTime: string;
  location: string;
  slotMinutes: number;
}

export interface HoldResult {
  intentId: string;
  checkoutUrl: string;
}

/** Every ptp/v2 response is wrapped in `{ data }`, or `{ error }` on failure. */
interface Envelope<T> {
  data: T;
}

// =============================================================================
// Helpers
// =============================================================================

const V2 = '/ptp/v2';

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.get<Envelope<T>>(`${V2}${path}`, { params });
  return response.data.data;
}

async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await apiClient.post<Envelope<T>>(`${V2}${path}`, body);
  return response.data.data;
}

// =============================================================================
// Public catalogue — no authentication required
// =============================================================================

export const getTrainers = (perPage = 40) =>
  get<TrainerSummary[]>('/trainers', { per_page: perPage });

export const getTrainer = (id: number) => get<TrainerDetail>(`/trainers/${id}`);

/**
 * Bookable slots for a trainer.
 *
 * Availability is public so a parent can browse before signing in. The server
 * clamps the range to its own horizon, so passing a wide window is safe.
 */
export const getTrainerSlots = (id: number, from?: string, to?: string) =>
  get<SlotDay[]>(`/trainers/${id}/slots`, { from, to });

// =============================================================================
// Parent — requires an authenticated parent
// =============================================================================

export const getMyPlayers = () => get<PlayerSummary[]>('/me/players');

export const getMyBookings = () => get<BookingSummary[]>('/me/bookings');

/**
 * Hold a slot and get the checkout URL.
 *
 * Open the returned `checkoutUrl` in a WebView or the system browser. Do not
 * attempt to complete payment in-app against a separate endpoint — there isn't
 * one, deliberately.
 *
 * Throws with a 409 when the slot has gone; refresh the slot list and let the
 * parent pick again.
 */
export const holdSlot = (trainerId: number, startsAt: string, playerId: number) =>
  post<HoldResult>('/bookings/hold', { trainerId, startsAt, playerId });

export const cancelBooking = (bookingId: number) =>
  post<{ cancelled: boolean }>(`/bookings/${bookingId}/cancel`);

// =============================================================================
// Trainer — requires an authenticated trainer
// =============================================================================

export const getTrainerSchedule = () => get<BookingSummary[]>('/trainer/schedule');

export const getTrainerEarnings = () => get<TrainerEarnings>('/trainer/earnings');

export const getMyAvailability = () =>
  get<{ rules: AvailabilityRule[]; blocked: string[] }>('/trainer/availability');

export const addAvailability = (rule: {
  weekday: number;
  startsTime: string;
  endsTime: string;
  location?: string;
  slotMinutes?: number;
}) => post<{ id: number }>('/trainer/availability', rule);

/**
 * Mark a session delivered. This releases the trainer's payout, so the server
 * checks the session belongs to the caller and has actually happened.
 */
export const completeSession = (bookingId: number) =>
  post<{ completed: boolean }>(`/trainer/sessions/${bookingId}/complete`);
