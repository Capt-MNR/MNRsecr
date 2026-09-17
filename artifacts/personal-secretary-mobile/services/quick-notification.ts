import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SECRETARY_PUSH_KIND } from './mobile-push';

export const QUICK_NOTIFICATION_CHANNEL_ID = 'quick-entry';
export const QUICK_NOTIFICATION_KIND = 'quick-entry';

let initializationPromise: Promise<void> | null = null;

function isQuickNotification(notification: Notifications.Notification) {
  return notification.request.content.data?.kind === QUICK_NOTIFICATION_KIND;
}

async function ensureQuickNotification() {
  if (Platform.OS !== 'android') return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });

  await Notifications.setNotificationChannelAsync(QUICK_NOTIFICATION_CHANNEL_ID, {
    name: 'Quick',
    description: 'Persistent entry point to Quick',
    importance: Notifications.AndroidImportance.LOW,
    sound: null,
    vibrationPattern: [],
    enableVibrate: false,
    enableLights: false,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return;

  const presentedNotifications = await Notifications.getPresentedNotificationsAsync();
  if (presentedNotifications.some(isQuickNotification)) return;

  await Notifications.scheduleNotificationAsync({
    identifier: QUICK_NOTIFICATION_KIND,
    content: {
      title: 'السكرتير السريع',
      body: 'اضغط لفتح Quick',
      data: { kind: QUICK_NOTIFICATION_KIND, route: 'quick' },
      sticky: true,
      autoDismiss: false,
      priority: Notifications.AndroidNotificationPriority.MIN,
    },
    trigger: { channelId: QUICK_NOTIFICATION_CHANNEL_ID },
  });
}

export function initializeQuickNotification() {
  if (Platform.OS !== 'android') return Promise.resolve();
  initializationPromise ??= ensureQuickNotification().catch(() => undefined);
  return initializationPromise;
}

export function isQuickNotificationResponse(response: Notifications.NotificationResponse | null | undefined) {
  const kind = response?.notification.request.content.data?.kind;
  return kind === QUICK_NOTIFICATION_KIND || kind === SECRETARY_PUSH_KIND;
}