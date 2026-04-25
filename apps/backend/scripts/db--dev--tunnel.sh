#!/bin/bash

cd supabase/supabase-dev-tunnel/supabase || exit

echo "Stopping Supabase..."
# even though it's a stop command, supabase still requires us to set the env vars.
doppler run -- supabase stop

echo "Starting Supabase..."
doppler run -- supabase start

cd - || exit
