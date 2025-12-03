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
// Child Profile Types
// =============================================================================

export interface ChildProfile {
  id: number;
  parent_id: number;
  name: string;
  birth_date?: string;
  age?: number;
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';
  experience_level?: ExperienceLevel;
  team?: string;
  position?: string;
  tshirt_size?: TShirtSize;
  notes?: string;
  medical_notes?: string;
  created_at?: string;
  updated_at?: string;
}

export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitive';

export type TShirtSize = 'YXS' | 'YS' | 'YM' | 'YL' | 'YXL' | 'AS' | 'AM' | 'AL' | 'AXL';

export interface CreateChildProfileRequest {
  name: string;
  birth_date?: string;
  gender?: ChildProfile['gender'];
  experience_level?: ExperienceLevel;
  team?: string;
  position?: string;
  tshirt_size?: TShirtSize;
  notes?: string;
  medical_notes?: string;
}

export interface UpdateChildProfileRequest extends Partial<CreateChildProfileRequest> {
  id: number;
}

// =============================================================================
// Order Types
// =============================================================================

export interface Order {
  id: number;
  order_number: string;
  status: OrderStatus;
  total: string;
  currency: string;
  date_created: string;
  date_paid?: string;
  line_items: OrderLineItem[];
  billing: OrderBilling;
  meta_data?: OrderMeta[];
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'on-hold'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'failed';

export interface OrderLineItem {
  id: number;
  name: string;
  product_id: number;
  quantity: number;
  subtotal: string;
  total: string;
  meta_data?: OrderMeta[];
  child_name?: string;
  child_age?: number;
  event_date?: string;
  event_time?: string;
  event_location?: string;
}

export interface OrderBilling {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
}

export interface OrderMeta {
  id: number;
  key: string;
  value: string;
}

// =============================================================================
// Filter Types
// =============================================================================

export interface CampFilters {
  category?: CampCategory | 'all';
  state?: StateCode | 'all';
  city?: string;
  ageGroup?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: 'date' | 'price' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export interface TrainerFilters {
  city?: string;
  specialty?: string;
  position?: string;
}

// =============================================================================
// Schedule / Session Extended Types
// =============================================================================

export interface ScheduleItem extends Session {
  child_name?: string;
  order_id?: number;
  product_id?: number;
  check_in_time?: string;
  check_out_time?: string;
  notes?: string;
}

// =============================================================================
// Navigation Types (Extended)
// =============================================================================

export type ProfileStackParamList = {
  ProfileMain: undefined;
  ChildProfiles: undefined;
  AddChildProfile: undefined;
  EditChildProfile: { child: ChildProfile };
  OrderHistory: undefined;
  OrderDetail: { order: Order };
  Settings: undefined;
};

export type CheckoutParams = {
  productUrl: string;
  productName?: string;
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

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// =============================================================================
// Push Notification Types
// =============================================================================

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: {
    type: NotificationType;
    screen?: string;
    params?: Record<string, unknown>;
  };
}

export type NotificationType =
  | 'session_reminder'
  | 'schedule_change'
  | 'weather_alert'
  | 'new_message'
  | 'promotion'
  | 'general';
