import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { setBaseUrl } from '@workspace/api-client-react';
import { ThemeProvider } from '@/hooks/useColors';
import { LanguageProvider } from '@/hooks/useLanguage';
import {
  handleSecretaryPushResponse,
  isSecretaryPushResponse,
  secretaryPushConversationId,
} from '../services/mobile-push';
import { isQuickNotificationResponse } from '../services/quick-notification';
import { AuthProvider, useAuth } from '../services/auth-context';

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
// The Expo web preview proxies /api on its own origin. Keeping web requests
// relative avoids a browser CORS preflight; native bundles still need the
// injected absolute API domain.
setBaseUrl(Platform.OS === 'web' ? null : apiDomain ? `https://${apiDomain}` : null);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const router = useRouter();
  const { loading, user } = useAuth();

  useEffect(() => {
    let active = true;
    async function routeNotification(response: Notifications.NotificationResponse) {
      if (isQuickNotificationResponse(response)) {
        router.replace('/');
        return;
      }
      if (!isSecretaryPushResponse(response)) return;
      await handleSecretaryPushResponse(response);
      if (!active) return;
      const conversationId = secretaryPushConversationId(response);
      router.replace(conversationId
        ? { pathname: '/', params: { conversationId } }
        : '/');
    }

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void routeNotification(response);
    });
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) void routeNotification(response);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);

  if (loading) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="index" />
        <Stack.Screen name="main" />
      </Stack.Protected>
      <Stack.Protected guard={!user}>
        <Stack.Screen name="auth" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (Platform.OS === 'web' || fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (Platform.OS !== 'web' && !fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LanguageProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <AuthProvider>
                <GestureHandlerRootView>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </AuthProvider>
            </QueryClientProvider>
          </ErrorBoundary>
        </LanguageProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
