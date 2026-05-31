cd supabase/supabase-dev/supabase &&

# even though it's a stop command, supabase still requires us to set the env vars.
doppler run --project backend --config dev_personal -- supabase stop


doppler run --project backend --config dev_personal -- supabase start

cd ../../../
