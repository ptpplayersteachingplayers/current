/**
 * PTP Mobile App - TypeScript Types
 *
 * These types define the shape of data returned from the WordPress API.
 * All fields marked as optional (?) may be missing from API responses.
 */

// =============================================================================
// User Types
// =============================================================================

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export type UserRole = 'customer' | 'subscriber' | 'administrator' | string;

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user_email: string;
  user_nicename: string;
  user_display_name: string;
}

// =============================================================================
// Camp / Clinic Types
// =============================================================================

export interface Camp {
  id: number;
  name: string;
  image: string | null;
  price: string;
  date: string;
  time: string;
  location: string;
  state: StateCode;
  bestseller: boolean;
  almost_full: boolean;
  product_url?: string;
  description?: string;
  category: CampCategory;
}

export type CampCategory = 'summer' | 'winter-clinics' | string;

export type StateCode = 'PA' | 'NJ' | 'DE' | 'MD' | 'NY' | string;

// =============================================================================
// Trainer Types
// =============================================================================

export interface Trainer {
  id: number;
  name: string;
  photo: string | null;
  college: string;
  bio: string;
  city: string;
  specialty: string;
  rating: number;
}

// =============================================================================
// Session Types (User's schedule)
// =============================================================================

export interface Session {
  id: number;
  type: SessionType;
  name: string;
  date: string;
  time: string;
  location: string;
  trainer_name?: string;
  status: SessionStatus;
}

export type SessionType = 'camp' | 'clinic' | 'training';

export type SessionStatus = 'upcoming' | 'completed' | 'cancelled';

// =============================================================================
// Device Registration (Push Notifications)
// =============================================================================

export interface DeviceRegistration {
  token: string;
  platform: 'ios' | 'android';
}

export interface DeviceRegistrationResponse {
  success: boolean;
}

// =============================================================================
// API Response Wrappers
// =============================================================================

export interface ApiError {
  code: string;
  message: string;
  data?: {
    status: number;
  };
}

export interface ApiResponse<T> {
  data: T;
  status: number;
}

// =============================================================================
// Navigation Types
// =============================================================================

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
};

export type MainTabParamList = {
  CampsTab: undefined;
  TrainingTab: undefined;
  ScheduleTab: undefined;
  ProfileTab: undefined;
};

export type CampsStackParamList = {
  Camps: undefined;
  CampDetail: { camp: Camp };
};

export type TrainingStackParamList = {
  Trainers: undefined;
  TrainerDetail: { trainer: Trainer };
};

// =============================================================================
// Utility Types
// =============================================================================

export interface LoadingState {
  isLoading: boolean;
  error: string | null;
}

export type DataState<T> = LoadingState & {
  data: T | null;
};
