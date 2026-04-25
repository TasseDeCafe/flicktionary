# why do we need this directory?

We created it so that the github action workflow for applying migrations in prod can have a separate directory. It would be unsafe to apply migrations from supabase-dev or supabase-dev-tunnel to production database. We actually never run this supabase config. We could probably remove everything besides /supabase/migrations

Note that running production build locally will not make you connect to the local supabase instance whose config is stored here, but rather the remote production database instance.
