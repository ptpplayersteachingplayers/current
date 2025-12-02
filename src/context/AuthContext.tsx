/**
 * PTP Mobile App - Authentication Context
 *
 * Provides:
 * - Current user state
 * - Loading state for auth operations
 * - Login/logout methods
 * - Automatic token loading on startup
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  login as apiLogin,
  registerUser as apiRegister,
  getMe,
  setAuthToken,
  clearAuthToken,
  loadStoredToken,
  ApiClientError,
} from '../api/client';
import { User, LoginCredentials, RegisterCredentials } from '../types';
import queryClient from '../api/queryClient';

// =============================================================================
// Types
// =============================================================================

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isInitialized: boolean;
  isGuest: boolean;
}

interface AuthContextValue extends AuthState {
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (credentials: RegisterCredentials) => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
  refreshUser: () => Promise<void>;
}

// =============================================================================
// Context
// =============================================================================

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// =============================================================================
// Provider
// =============================================================================

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: false,
    isInitialized: false,
    isGuest: false,
  });

  /**
   * Initialize auth state by checking for stored token
   */
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const token = await loadStoredToken();

        if (token) {
          // Try to fetch user info with stored token
          try {
            const user = await getMe();
            setState({
              user,
              isLoading: false,
              isInitialized: true,
              isGuest: false,
            });

          } catch (error) {
            // Token is invalid or expired, clear it
            console.log('Stored token invalid, clearing...');
            await clearAuthToken();
            setState({
              user: null,
              isLoading: false,
              isInitialized: true,
              isGuest: false,
            });
          }
        } else {
          // No stored token
          setState({
            user: null,
            isLoading: false,
            isInitialized: true,
            isGuest: false,
          });
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
        setState({
          user: null,
          isLoading: false,
          isInitialized: true,
          isGuest: false,
        });
      }
    };

    initializeAuth();
  }, []);

  /**
   * Login with credentials
   */
  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Call login API
      const loginResponse = await apiLogin(credentials);

      // Store the token
      await setAuthToken(loginResponse.token);

      // Fetch full user info
      const user = await getMe();

      setState({
        user,
        isLoading: false,
        isInitialized: true,
        isGuest: false,
      });

    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));

      // Re-throw with user-friendly message
      if (error instanceof ApiClientError) {
        // Handle specific login errors
        if (error.code === 'invalid_username' || error.code === 'incorrect_password') {
          throw new Error('Invalid email or password. Please try again.');
        }
        if (error.code === '[jwt_auth] invalid_username') {
          throw new Error('Invalid email or password. Please try again.');
        }
        if (error.code === '[jwt_auth] incorrect_password') {
          throw new Error('Invalid email or password. Please try again.');
        }
        throw new Error(error.message);
      }

      throw new Error('Unable to log in. Please check your connection and try again.');
    }
  }, []);

  /**
   * Logout - clear token and user
   */
  const logout = useCallback(async (): Promise<void> => {
    try {
      await clearAuthToken();
      queryClient.clear();
    } catch (error) {
      console.error('Error clearing token:', error);
    } finally {
      setState({
        user: null,
        isLoading: false,
        isInitialized: true,
        isGuest: false,
      });
    }
  }, []);

  /**
   * Continue as guest - allow browsing without login
   */
  const continueAsGuest = useCallback((): void => {
    setState({
      user: null,
      isLoading: false,
      isInitialized: true,
      isGuest: true,
    });
  }, []);

  /**
   * Register a new user
   */
  const register = useCallback(async (credentials: RegisterCredentials): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      // Call register API
      await apiRegister(credentials);

      // Auto-login after successful registration
      const loginResponse = await apiLogin({
        username: credentials.email,
        password: credentials.password,
      });

      // Store the token
      await setAuthToken(loginResponse.token);

      // Fetch full user info
      const user = await getMe();

      setState({
        user,
        isLoading: false,
        isInitialized: true,
        isGuest: false,
      });

    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));

      if (error instanceof ApiClientError) {
        if (error.code === 'registration_failed' || error.message.includes('exists')) {
          throw new Error('An account with this email already exists.');
        }
        throw new Error(error.message);
      }

      throw new Error('Unable to create account. Please try again.');
    }
  }, []);

  /**
   * Refresh user data from server
   */
  const refreshUser = useCallback(async (): Promise<void> => {
    try {
      const user = await getMe();
      setState((prev) => ({ ...prev, user }));
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  }, []);

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    continueAsGuest,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// =============================================================================
// Hook
// =============================================================================

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

// =============================================================================
// Export
// =============================================================================

export default AuthContext;
