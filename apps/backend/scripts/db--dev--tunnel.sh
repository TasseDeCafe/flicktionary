#!/bin/bash

cd supabase/supabase-dev-tunnel/supabase || exit

echo "Stopping Supabase..."
# even though it's a stop command, supabase still requires us to set the env vars.
doppler run --project backend --config dev_personal -- supabase stop

echo "Starting Supabase..."
doppler run --project backend --config dev_personal -- supabase start

cd - || exit
