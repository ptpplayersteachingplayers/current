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
  Register: undefined;
  ForgotPassword: undefined;
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
  Cart: undefined;
  Checkout: undefined;
  Orders: undefined;
};

export type TrainingStackParamList = {
  Trainers: undefined;
  TrainerDetail: { trainer: Trainer };
};

export type MessagesStackParamList = {
  ChatList: undefined;
  Chat: { conversationId: string; title?: string };
};

export type ProfileStackParamList = {
  Profile: undefined;
  EditProfile: undefined;
  Orders: undefined;
  OrderDetail: { order: Order };
};

// =============================================================================
// Registration Types
// =============================================================================

export interface RegisterCredentials {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  success: boolean;
  message: string;
  user_id?: number;
}

// =============================================================================
// Cart Types
// =============================================================================

export interface CartItem {
  id: number;
  productId: number;
  name: string;
  price: string;
  quantity: number;
  image?: string;
  date?: string;
}

export interface AddToCartRequest {
  productId: number;
  quantity: number;
}

// =============================================================================
// Order Types
// =============================================================================

export interface Order {
  id: number;
  orderNumber: string;
  date: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal?: string;
  discount?: string;
  tax?: string;
  total: string;
  billing?: BillingInfo;
  paymentMethod?: 'card' | 'paypal';
  transactionId?: string;
}

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export interface OrderItem {
  id: number;
  name: string;
  price: string;
  quantity: number;
  date?: string;
  location?: string;
}

export interface BillingInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface CreateOrderRequest {
  billing: BillingInfo;
  paymentMethod: 'card' | 'paypal';
  items: { productId: number; quantity: number }[];
}

export interface CreateOrderResponse {
  orderId: number;
  orderNumber: string;
  paymentUrl?: string;
}

// =============================================================================
// Profile Types
// =============================================================================

export interface UpdateProfileRequest {
  firstName: string;
  lastName: string;
  email: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

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
