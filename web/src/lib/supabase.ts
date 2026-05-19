import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client (uses service_role). NEVER import from a
// client component — the key would be bundled to the browser and exposed.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
