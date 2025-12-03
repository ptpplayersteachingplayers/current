/**
 * PTP Mobile App - Push Notification Service
 *
 * Handles registration, permission requests, and notification handling
 * using expo-notifications.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { registerDevice } from '../api/client';

// Configure how notifications are handled when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Request notification permissions and get the push token
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push notifications only work on physical devices
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  try {
    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permission if not already granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push notification permission');
      return null;
    }

    // Get the Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });

    const token = tokenData.data;

    // Configure Android notification channel
    if (Platform.OS === 'android') {
      await setupAndroidNotificationChannels();
    }

    return token;
  } catch (error) {
    console.error('Error registering for push notifications:', error);
    return null;
  }
}

/**
 * Setup Android notification channels
 */
async function setupAndroidNotificationChannels() {
  // Default channel for general notifications
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FCB900',
  });

  // Channel for session reminders
  await Notifications.setNotificationChannelAsync('reminders', {
    name: 'Session Reminders',
    description: 'Reminders for upcoming camps and training sessions',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FCB900',
  });

  // Channel for messages
  await Notifications.setNotificationChannelAsync('messages', {
    name: 'Messages',
    description: 'Messages from trainers and PTP support',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  });

  // Channel for announcements
  await Notifications.setNotificationChannelAsync('announcements', {
    name: 'Announcements',
    description: 'Important updates and new program announcements',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Register push token with the backend
 */
export async function registerPushTokenWithServer(token: string): Promise<boolean> {
  try {
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    await registerDevice({ token, platform });
    console.log('Push token registered with server');
    return true;
  } catch (error) {
    console.error('Failed to register push token with server:', error);
    return false;
  }
}

/**
 * Add a listener for notification responses (when user taps notification)
 */
export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

/**
 * Add a listener for received notifications (when app is in foreground)
 */
export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(callback);
}

/**
 * Get the notification that launched the app (if any)
 */
export async function getLastNotificationResponse(): Promise<Notifications.NotificationResponse | null> {
  return await Notifications.getLastNotificationResponseAsync();
}

/**
 * Schedule a local notification
 */
export async function scheduleLocalNotification(
  title: string,
  body: string,
  trigger: Notifications.NotificationTriggerInput,
  data?: Record<string, unknown>
): Promise<string> {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: data ?? {},
    },
    trigger,
  });
  return id;
}

/**
 * Cancel a scheduled notification
 */
export async function cancelScheduledNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllScheduledNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get current badge count
 */
export async function getBadgeCount(): Promise<number> {
  return await Notifications.getBadgeCountAsync();
}

/**
 * Set badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

/**
 * Clear badge
 */
export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
}

/**
 * Parse notification data to determine navigation target
 */
export function parseNotificationData(data: Record<string, unknown>): {
  screen?: string;
  params?: Record<string, unknown>;
} {
  const type = data?.type as string | undefined;

  switch (type) {
    case 'session_reminder':
    case 'schedule_change':
      return {
        screen: 'ScheduleTab',
        params: data.sessionId ? { sessionId: data.sessionId } : undefined,
      };

    case 'new_message':
      return {
        screen: 'MessagesTab',
        params: data.conversationId
          ? { screen: 'Chat', params: { conversationId: data.conversationId } }
          : undefined,
      };

    case 'weather_alert':
      return {
        screen: 'ScheduleTab',
      };

    case 'promotion':
      return {
        screen: 'CampsTab',
        params: data.campId ? { campId: data.campId } : undefined,
      };

    default:
      return {
        screen: data?.screen as string | undefined,
        params: data?.params as Record<string, unknown> | undefined,
      };
  }
}

export default {
  registerForPushNotificationsAsync,
  registerPushTokenWithServer,
  addNotificationResponseListener,
  addNotificationReceivedListener,
  getLastNotificationResponse,
  scheduleLocalNotification,
  cancelScheduledNotification,
  cancelAllScheduledNotifications,
  getBadgeCount,
  setBadgeCount,
  clearBadge,
  parseNotificationData,
};
