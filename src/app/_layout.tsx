import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerBackTitle: 'Back' }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Sign in' }} />
        <Stack.Screen name="group/[groupId]" options={{ title: 'Group' }} />
        <Stack.Screen name="listen/[messageId]" options={{ headerShown: false }} />
        <Stack.Screen name="record/[threadId]" options={{ headerShown: false }} />
        <Stack.Screen name="episode/[threadId]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
