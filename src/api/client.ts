/**
 * PTP Mobile App - API Client
 *
 * Centralized Axios instance with:
 * - Base URL configuration
 * - JWT token management via interceptors
 * - Typed API functions
 * - Error handling utilities
 */

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';
import {
  User,
  Camp,
  Trainer,
  Session,
  LoginCredentials,
  LoginResponse,
  RegisterCredentials,
  RegisterResponse,
  DeviceRegistration,
  DeviceRegistrationResponse,
  ApiError,
  AppConfig,
  ChildProfile,
  CreateChildProfileRequest,
  UpdateChildProfileRequest,
  Order,
  CampFilters,
} from '../types';

// =============================================================================
// Configuration
// =============================================================================

const API_BASE_URL = 'https://ptpsummercamps.com/wp-json';
const TOKEN_KEY = 'ptp_auth_token';

// Request timeout (10 seconds)
const REQUEST_TIMEOUT = 10000;

// =============================================================================
// Token Management
// =============================================================================

let authToken: string | null = null;

/**
 * Store the auth token securely and in memory
 */
export const setAuthToken = async (token: string): Promise<void> => {
  authToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
};

/**
 * Clear the auth token from memory and storage
 */
export const clearAuthToken = async (): Promise<void> => {
  authToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};

/**
 * Load token from secure storage into memory
 */
export const loadStoredToken = async (): Promise<string | null> => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  authToken = token;
  return token;
};

/**
 * Get current token (from memory)
 */
export const getAuthToken = (): string | null => {
  return authToken;
};

// =============================================================================
// Axios Instance
// =============================================================================

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach JWT token if available
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (authToken && config.headers) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor - handle common errors
apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    // Handle specific error cases
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      // 401 Unauthorized - token expired or invalid
      if (status === 401) {
        // Token will be cleared by AuthContext when it catches this error
        return Promise.reject(new ApiClientError(
          'Your session has expired. Please log in again.',
          'SESSION_EXPIRED',
          status
        ));
      }

      // 403 Forbidden
      if (status === 403) {
        return Promise.reject(new ApiClientError(
          'You do not have permission to perform this action.',
          'FORBIDDEN',
          status
        ));
      }

      // 404 Not Found
      if (status === 404) {
        return Promise.reject(new ApiClientError(
          'The requested resource was not found.',
          'NOT_FOUND',
          status
        ));
      }

      // 500+ Server errors
      if (status >= 500) {
        return Promise.reject(new ApiClientError(
          'Server error. Please try again later.',
          'SERVER_ERROR',
          status
        ));
      }

      // Other errors with message from server
      const message = data?.message || 'An unexpected error occurred.';
      const code = data?.code || 'UNKNOWN_ERROR';
      return Promise.reject(new ApiClientError(message, code, status));
    }

    // Network error (no response)
    if (error.request) {
      return Promise.reject(new ApiClientError(
        'Network error. Please check your connection and try again.',
        'NETWORK_ERROR',
        0
      ));
    }

    // Request setup error
    return Promise.reject(new ApiClientError(
      'An unexpected error occurred.',
      'REQUEST_ERROR',
      0
    ));
  }
);

// =============================================================================
// Custom Error Class
// =============================================================================

export class ApiClientError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }

  isSessionExpired(): boolean {
    return this.code === 'SESSION_EXPIRED' || this.status === 401;
  }

  isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Login with username/email and password
 * Returns JWT token and user info
 */
export const login = async (credentials: LoginCredentials): Promise<LoginResponse> => {
  const response = await apiClient.post<LoginResponse>(
    '/jwt-auth/v1/token',
    credentials
  );
  return response.data;
};

/**
 * Register a new user account
 * Returns user info on success
 */
export const register = async (credentials: RegisterCredentials): Promise<RegisterResponse> => {
  const response = await apiClient.post<RegisterResponse>(
    '/ptp/v1/register',
    credentials
  );
  return response.data;
};

/**
 * Get current user info
 * Requires authentication
 */
export const getMe = async (): Promise<User> => {
  const response = await apiClient.get<User>('/ptp/v1/me');
  return response.data;
};

/**
 * Get list of camps and clinics
 * Public endpoint (but we call it authenticated for consistency)
 */
export interface GetCampsParams {
  lat?: number;
  lng?: number;
  radius?: number;
}

export const getCamps = async (params?: GetCampsParams): Promise<Camp[]> => {
  const response = await apiClient.get<Camp[]>('/ptp/v1/camps', {
    params,
  });

  // Defensive: ensure we always return an array
  if (!Array.isArray(response.data)) {
    console.warn('getCamps: Expected array, got:', typeof response.data);
    return [];
  }

  // Normalize camp data with defaults for missing fields
  return response.data.map(normalizeCamp);
};

/**
 * Get list of trainers
 * Public endpoint
 */
export const getTrainers = async (): Promise<Trainer[]> => {
  const response = await apiClient.get<Trainer[]>('/ptp/v1/trainers');

  // Defensive: ensure we always return an array
  if (!Array.isArray(response.data)) {
    console.warn('getTrainers: Expected array, got:', typeof response.data);
    return [];
  }

  // Normalize trainer data with defaults for missing fields
  return response.data.map(normalizeTrainer);
};

/**
 * Get user's sessions (schedule)
 * Requires authentication
 */
export const getSessions = async (): Promise<Session[]> => {
  const response = await apiClient.get<Session[]>('/ptp/v1/sessions');

  // Defensive: ensure we always return an array
  if (!Array.isArray(response.data)) {
    console.warn('getSessions: Expected array, got:', typeof response.data);
    return [];
  }

  // Normalize session data with defaults
  return response.data.map(normalizeSession);
};

/**
 * Get app-level configuration flags and banners
 */
export const getAppConfig = async (): Promise<AppConfig> => {
  const response = await apiClient.get<AppConfig>('/ptp/v1/app-config');
  return response.data;
};

/**
 * Register device for push notifications
 * Requires authentication
 */
export const registerDevice = async (
  registration: DeviceRegistration
): Promise<DeviceRegistrationResponse> => {
  const response = await apiClient.post<DeviceRegistrationResponse>(
    '/ptp/v1/devices',
    registration
  );
  return response.data;
};

// =============================================================================
// Data Normalization Helpers
// =============================================================================

/**
 * Normalize camp data with safe defaults
 */
const normalizeCamp = (raw: Partial<Camp>): Camp => {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? 'Unknown Camp',
    image: raw.image ?? null,
    price: raw.price ?? '$0',
    date: raw.date ?? '',
    time: raw.time ?? '',
    location: raw.location ?? '',
    state: raw.state ?? '',
    bestseller: Boolean(raw.bestseller),
    almost_full: Boolean(raw.almost_full || raw.isAlmostFull),
    availableSeats: typeof raw.availableSeats === 'number'
      ? raw.availableSeats
      : typeof raw.availableSeats === 'string'
      ? parseInt(raw.availableSeats, 10) || undefined
      : undefined,
    isAlmostFull: Boolean(raw.isAlmostFull ?? raw.almost_full),
    isWaitlistOnly: Boolean(raw.isWaitlistOnly),
    latitude: typeof raw.latitude === 'number' ? raw.latitude : undefined,
    longitude: typeof raw.longitude === 'number' ? raw.longitude : undefined,
    product_url: raw.product_url,
    description: raw.description,
    category: raw.category ?? 'summer',
  };
};

/**
 * Normalize trainer data with safe defaults
 */
const normalizeTrainer = (raw: Partial<Trainer>): Trainer => {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? 'Unknown Trainer',
    photo: raw.photo ?? null,
    college: raw.college ?? '',
    bio: raw.bio ?? '',
    city: raw.city ?? '',
    specialty: raw.specialty ?? '',
    rating: typeof raw.rating === 'number' ? raw.rating : 0,
  };
};

/**
 * Normalize session data with safe defaults
 */
const normalizeSession = (raw: Partial<Session>): Session => {
  return {
    id: raw.id ?? 0,
    type: raw.type ?? 'camp',
    name: raw.name ?? 'Unknown Event',
    date: raw.date ?? '',
    time: raw.time ?? '',
    location: raw.location ?? '',
    trainer_name: raw.trainer_name,
    status: raw.status ?? 'upcoming',
  };
};

/**
 * Normalize child profile data with safe defaults
 */
const normalizeChildProfile = (raw: Partial<ChildProfile>): ChildProfile => {
  return {
    id: raw.id ?? 0,
    parent_id: raw.parent_id ?? 0,
    name: raw.name ?? 'Child',
    birth_date: raw.birth_date,
    age: raw.age,
    gender: raw.gender,
    experience_level: raw.experience_level,
    team: raw.team,
    position: raw.position,
    tshirt_size: raw.tshirt_size,
    notes: raw.notes,
    medical_notes: raw.medical_notes,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
};

/**
 * Normalize order data with safe defaults
 */
const normalizeOrder = (raw: Partial<Order>): Order => {
  return {
    id: raw.id ?? 0,
    order_number: raw.order_number ?? String(raw.id ?? 0),
    status: raw.status ?? 'pending',
    total: raw.total ?? '$0.00',
    currency: raw.currency ?? 'USD',
    date_created: raw.date_created ?? '',
    date_paid: raw.date_paid,
    line_items: raw.line_items ?? [],
    billing: raw.billing ?? { first_name: '', last_name: '', email: '' },
    meta_data: raw.meta_data,
  };
};

// =============================================================================
// Child Profile API Functions
// =============================================================================

/**
 * Get all child profiles for the authenticated user
 * Requires authentication
 */
export const getChildProfiles = async (): Promise<ChildProfile[]> => {
  const response = await apiClient.get<ChildProfile[]>('/ptp/v1/children');

  if (!Array.isArray(response.data)) {
    console.warn('getChildProfiles: Expected array, got:', typeof response.data);
    return [];
  }

  return response.data.map(normalizeChildProfile);
};

/**
 * Get a single child profile by ID
 * Requires authentication
 */
export const getChildProfile = async (childId: number): Promise<ChildProfile> => {
  const response = await apiClient.get<ChildProfile>(`/ptp/v1/children/${childId}`);
  return normalizeChildProfile(response.data);
};

/**
 * Create a new child profile
 * Requires authentication
 */
export const createChildProfile = async (
  data: CreateChildProfileRequest
): Promise<ChildProfile> => {
  const response = await apiClient.post<ChildProfile>('/ptp/v1/children', data);
  return normalizeChildProfile(response.data);
};

/**
 * Update an existing child profile
 * Requires authentication
 */
export const updateChildProfile = async (
  data: UpdateChildProfileRequest
): Promise<ChildProfile> => {
  const { id, ...updateData } = data;
  const response = await apiClient.put<ChildProfile>(
    `/ptp/v1/children/${id}`,
    updateData
  );
  return normalizeChildProfile(response.data);
};

/**
 * Delete a child profile
 * Requires authentication
 */
export const deleteChildProfile = async (childId: number): Promise<void> => {
  await apiClient.delete(`/ptp/v1/children/${childId}`);
};

// =============================================================================
// Order API Functions
// =============================================================================

/**
 * Get all orders for the authenticated user
 * Requires authentication
 */
export const getOrders = async (): Promise<Order[]> => {
  const response = await apiClient.get<Order[]>('/ptp/v1/orders');

  if (!Array.isArray(response.data)) {
    console.warn('getOrders: Expected array, got:', typeof response.data);
    return [];
  }

  return response.data.map(normalizeOrder);
};

/**
 * Get a single order by ID
 * Requires authentication
 */
export const getOrder = async (orderId: number): Promise<Order> => {
  const response = await apiClient.get<Order>(`/ptp/v1/orders/${orderId}`);
  return normalizeOrder(response.data);
};

// =============================================================================
// Camps with Filters
// =============================================================================

/**
 * Get camps with optional filters
 * Public endpoint
 */
export const getCampsWithFilters = async (
  filters?: CampFilters
): Promise<Camp[]> => {
  const params: Record<string, string | number | undefined> = {};

  if (filters) {
    if (filters.category && filters.category !== 'all') {
      params.category = filters.category;
    }
    if (filters.state && filters.state !== 'all') {
      params.state = filters.state;
    }
    if (filters.city) {
      params.city = filters.city;
    }
    if (filters.ageGroup) {
      params.age_group = filters.ageGroup;
    }
    if (filters.dateFrom) {
      params.date_from = filters.dateFrom;
    }
    if (filters.dateTo) {
      params.date_to = filters.dateTo;
    }
    if (filters.sortBy) {
      params.orderby = filters.sortBy;
    }
    if (filters.sortOrder) {
      params.order = filters.sortOrder;
    }
  }

  const response = await apiClient.get<Camp[]>('/ptp/v1/camps', { params });

  if (!Array.isArray(response.data)) {
    console.warn('getCampsWithFilters: Expected array, got:', typeof response.data);
    return [];
  }

  return response.data.map(normalizeCamp);
};

// =============================================================================
// Password Reset
// =============================================================================

/**
 * Request a password reset email
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  await apiClient.post('/ptp/v1/password-reset', { email });
};

// =============================================================================
// Export
// =============================================================================

export default apiClient;
