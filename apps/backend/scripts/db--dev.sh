cd supabase/supabase-dev/supabase &&

# even though it's a stop command, supabase still requires us to set the env vars.
doppler run -- supabase stop


doppler run -- supabase start

cd ../../../
