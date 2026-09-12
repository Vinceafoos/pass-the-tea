import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { config, isSupabaseConfigured } from '@/constants/config';
import type { Database } from '@/types/database';

if (!isSupabaseConfigured()) {
  console.warn(
    'Supabase is not configured. Copy .env.example to .env and add your project URL and anon key.'
  );
}

export const supabase = createClient<Database>(
  config.supabaseUrl || 'https://example.supabase.co',
  config.supabaseAnonKey || 'public-anon-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
