import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getFlicktionaryConfig } from './flicktionary-config';
import {
    clearFlicktionaryAuth,
    FlicktionaryAuthState,
    getFlicktionaryAuth,
    setFlicktionaryAuth,
} from './auth-storage';

let cached: SupabaseClient | null = null;

// Background-side Supabase client used to verifyOtp during pairing and to
// refresh access tokens after that. Auto persistence is off — we own the
// storage and write to `browser.storage.local` via `auth-storage.ts` so the
// session is visible to both background and content scripts and is kept out
// of the asbplayer settings export.
export const getFlicktionarySupabase = (): SupabaseClient => {
    if (cached) return cached;
    const { supabaseProjectUrl, supabasePublishableKey } = getFlicktionaryConfig();
    cached = createClient(supabaseProjectUrl, supabasePublishableKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
            detectSessionInUrl: false,
        },
    });
    return cached;
};

export const persistSupabaseSession = async (params: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    user: { id: string; email?: string | null };
}): Promise<FlicktionaryAuthState> => {
    if (!params.user.email) {
        throw new Error('Paired Supabase session is missing email');
    }
    const state: FlicktionaryAuthState = {
        accessToken: params.access_token,
        refreshToken: params.refresh_token,
        expiresAt: params.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
        userId: params.user.id,
        email: params.user.email,
    };
    await setFlicktionaryAuth(state);
    return state;
};

export const refreshAccessTokenIfNeeded = async (): Promise<FlicktionaryAuthState | null> => {
    const current = await getFlicktionaryAuth();
    if (!current) return null;

    const nowSeconds = Math.floor(Date.now() / 1000);
    // Refresh ~1 minute before expiry to absorb clock skew.
    if (current.expiresAt - nowSeconds > 60) {
        return current;
    }

    const { data, error } = await getFlicktionarySupabase().auth.refreshSession({
        refresh_token: current.refreshToken,
    });
    if (error || !data?.session || !data.user) {
        // Token is unusable; clear so the popup can prompt re-pair.
        await clearFlicktionaryAuth();
        return null;
    }
    return persistSupabaseSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at ?? undefined,
        user: { id: data.user.id, email: data.user.email },
    });
};

export const getCurrentAccessToken = async (): Promise<string | null> => {
    const fresh = await refreshAccessTokenIfNeeded();
    return fresh?.accessToken ?? null;
};
