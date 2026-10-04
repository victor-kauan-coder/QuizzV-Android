import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl = "https://robkeahutptlkgtryvws.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvYmtlYWh1dHB0bGtndHJ5dndzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5ODA4NDgsImV4cCI6MjA5MDU1Njg0OH0.QMAWpkQ43itSfFJROMKQ63vmiI4IEWd6x7USpDcKP2E";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
