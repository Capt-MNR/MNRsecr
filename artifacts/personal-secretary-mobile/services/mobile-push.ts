import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerMobilePushToken } from '@workspace/api-client-react';

export const SECRETARY_PUSH_KIND = 'secretary-event';

let registrationPromise: Promise<boolean> | null = null;

function appId() {
  return Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.bundleIdentifier ?? 'personal-secretary-mobile'
    : Constants.expoConfig?.android?.package
      ?? Constants.expoConfig?.slug
      ?? 'personal-secretary-mobile';
}

async function registerForSecretaryPush(): Promise<boolean> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return false;

  // Expo's gateway forwards the notification to FCM or APNs for the device.
  // The project id is optional in Expo Go and supplied automatically by a
  // native build when EAS config is present.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  await registerMobilePushToken({
    token: token.data,
    provider: 'expo',
    platform: Platform.OS,
    appId: appId(),
  });
  return true;
}

export function initializeSecretaryPush(): Promise<boolean> {
  registrationPromise ??= registerForSecretaryPush().catch(() => false);
  return registrationPromise;
}

export function isSecretaryPushResponse(
  response: Notifications.NotificationResponse | null | undefined,
) {
  return response?.notification.request.content.data?.kind === SECRETARY_PUSH_KIND;
}