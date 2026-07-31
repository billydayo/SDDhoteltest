const getRuntimeValue = (keys = []) => {
  const values = [];
  for (const key of keys) {
    const value =
      globalThis?.[key] ||
      globalThis?.__SUNNY_CONFIG__?.[key] ||
      (typeof importMeta !== 'undefined' ? importMeta.env?.[key] : undefined) ||
      (typeof process !== 'undefined' ? process.env?.[key] : undefined);

    if (value) values.push(String(value));
  }

  return values[0] || '';
};

export const supabaseConfig = {
  url: getRuntimeValue(['VITE_SUPABASE_URL', 'SUPABASE_URL']),
  anonKey: getRuntimeValue(['VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY']),
  serviceRoleKey: getRuntimeValue(['VITE_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])
};

export const isSupabaseConfigured = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

export const demoMode = {
  enabled: !isSupabaseConfigured,
  message: 'Supabase not configured. Running in browser localStorage demo mode.'
};

export const getSupabaseClient = async () => {
  if (!isSupabaseConfigured) {
    return null;
  }

  if (!globalThis.supabase) {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    globalThis.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
  }

  return globalThis.supabase;
};

if (typeof window !== 'undefined') {
  window.__SUNNY_DEMO_MODE__ = demoMode.enabled;
  window.__SUPABASE_CONFIG__ = supabaseConfig;
}
