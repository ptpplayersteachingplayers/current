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

export interface RegisterCredentials {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

export interface RegisterResponse {
  id: number;
  email: string;
  name: string;
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
  availableSeats?: number;
  isAlmostFull?: boolean;
  isWaitlistOnly?: boolean;
  latitude?: number;
  longitude?: number;
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
  conversation_id?: string;
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
// App Config (WordPress driven)
// =============================================================================

export interface AppFeatureFlags {
  enablePrivateTraining?: boolean;
  enableMessaging?: boolean;
}

export interface AppBanner {
  id: string;
  title: string;
  body: string;
  ctaText: string;
  url: string;
}

export interface AppConfig {
  minSupportedAppVersion: string;
  features: AppFeatureFlags;
  banners: AppBanner[];
}

// =============================================================================
// Messaging (Supabase)
// =============================================================================

export type UserRoleType = 'parent' | 'trainer' | 'support';

export interface ChatUser {
  id: string;
  wp_user_id?: number;
  name: string;
  role: UserRoleType;
}

export type ConversationType = 'parent-trainer' | 'parent-support' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  participant_ids: string[];
  camp_id?: string | null;
  created_at?: string;
  last_message_text?: string;
  last_message_at?: string;
  title?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  seen_by?: string[];
  is_system?: boolean;
  optimistic?: boolean;
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
  HomeTab: undefined;
  CampsTab: undefined;
  TrainingTab: undefined;
  ScheduleTab: undefined;
  MessagesTab: undefined;
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

export type MessagesStackParamList = {
  ChatList: undefined;
  Chat: { conversationId: string; title?: string };
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
