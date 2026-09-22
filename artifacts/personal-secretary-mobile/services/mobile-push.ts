import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  approveSecretaryOperation,
  registerMobilePushToken,
  rejectSecretaryOperation,
} from '@workspace/api-client-react';
import { Linking } from 'react-native';

export const SECRETARY_PUSH_KIND = 'secretary-event';
export const SECRETARY_PUSH_CATEGORY = 'secretary-approval';
export const SECRETARY_APPROVE_ACTION = 'secretary-approve';
export const SECRETARY_REJECT_ACTION = 'secretary-reject';

let registrationPromise: Promise<boolean> | null = null;
let categoryPromise: Promise<void> | null = null;
const handledResponseIds = new Set<string>();

export type SecretaryPushStatus =
  | 'registered'
  | 'unsupported'
  | 'permission-denied'
  | 'failed';

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
    deviceId: Constants.deviceId ?? null,
  });
  return true;
}

export async function configureSecretaryPushActions(): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  categoryPromise ??= (async () => {
    await Notifications.setNotificationCategoryAsync(
      SECRETARY_PUSH_CATEGORY,
      [
        {
          identifier: SECRETARY_APPROVE_ACTION,
          buttonTitle: 'اعتماد',
          options: { opensAppToForeground: true },
        },
        {
          identifier: SECRETARY_REJECT_ACTION,
          buttonTitle: 'رفض',
          options: { isDestructive: true, opensAppToForeground: true },
        },
      ],
    );
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('secretary-events', {
        name: 'Secretary',
        description: 'Secretary approvals and reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
        vibrationPattern: [0, 250, 150, 250],
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }
  })();
  await categoryPromise;
}

export async function initializeSecretaryPush(): Promise<SecretaryPushStatus> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'unsupported';
  await configureSecretaryPushActions().catch(() => undefined);
  registrationPromise ??= registerForSecretaryPush().catch(() => false);
  try {
    const registered = await registrationPromise;
    if (registered) return 'registered';
    const permission = await Notifications.getPermissionsAsync();
    return permission.status === 'denied' ? 'permission-denied' : 'failed';
  } catch {
    return 'failed';
  }
}

export function retrySecretaryPush(): Promise<SecretaryPushStatus> {
  registrationPromise = null;
  return initializeSecretaryPush();
}

export async function openSecretaryNotificationSettings(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Linking.openSettings();
  } catch {
    // The status banner remains visible so the user can retry later.
  }
}

export function isSecretaryPushResponse(
  response: Notifications.NotificationResponse | null | undefined,
) {
  return response?.notification.request.content.data?.kind === SECRETARY_PUSH_KIND;
}

export function secretaryPushConversationId(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const conversationId = response?.notification.request.content.data?.conversationId;
  return typeof conversationId === 'string' && conversationId ? conversationId : null;
}

export async function handleSecretaryPushResponse(
  response: Notifications.NotificationResponse,
): Promise<'ignored' | 'approved' | 'rejected' | 'failed'> {
  if (!isSecretaryPushResponse(response)) return 'ignored';
  const responseId = response.notification.request.identifier;
  if (handledResponseIds.has(responseId)) return 'ignored';

  const operationId = response.notification.request.content.data?.operationId;
  if (typeof operationId !== 'string' || !operationId) return 'ignored';
  const actionIdentifier = response.actionIdentifier;
  if (actionIdentifier === SECRETARY_APPROVE_ACTION) {
    try {
      await approveSecretaryOperation(operationId);
      handledResponseIds.add(responseId);
      return 'approved';
    } catch {
      return 'failed';
    }
  }
  if (actionIdentifier === SECRETARY_REJECT_ACTION) {
    try {
      await rejectSecretaryOperation(operationId);
      handledResponseIds.add(responseId);
      return 'rejected';
    } catch {
      return 'failed';
    }
  }
  return 'ignored';
}