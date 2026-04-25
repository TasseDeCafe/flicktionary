cd supabase/supabase-test/supabase
supabase start
supabase migration up
cd ../../../
vitest run --config vitest.config.mts
