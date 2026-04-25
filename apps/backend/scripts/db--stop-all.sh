#!/bin/bash

cd supabase/supabase-dev/supabase &&
# even though it's a stop command, supabase still requires us to set the env vars.
doppler run -- supabase stop
cd ../../../


cd supabase/supabase-test/supabase &&
supabase stop
cd ../../../


cd supabase/supabase-dev-tunnel/supabase &&
# even though it's a stop command, supabase still requires us to set the env vars.
doppler run -- supabase stop
cd ../../../
