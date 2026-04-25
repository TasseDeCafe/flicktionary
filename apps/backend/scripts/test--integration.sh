cd supabase/supabase-test/supabase
supabase start
supabase migration up
cd ../../../
vitest --config vitest.config.mts
