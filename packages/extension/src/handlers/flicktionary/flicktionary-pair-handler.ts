import { Command, Message } from '@asbplayer-fork/common';
import {
    getFlicktionarySupabase,
    persistSupabaseSession,
} from '../../services/flicktionary/flicktionary-supabase-client';
import {
    clearPendingFlicktionaryPairNonce,
    getPendingFlicktionaryPairNonce,
} from '../../services/flicktionary/pairing-nonce-storage';

interface FlicktionaryPairMessage extends Message {
    command: 'flicktionary-pair';
    tokenHash: string;
    email: string;
    nonce: string;
}

const isPairMessage = (msg: unknown): msg is FlicktionaryPairMessage => {
    if (!msg || typeof msg !== 'object') return false;
    const m = msg as Record<string, unknown>;
    return (
        m.command === 'flicktionary-pair' &&
        typeof m.tokenHash === 'string' &&
        typeof m.email === 'string' &&
        typeof m.nonce === 'string'
    );
};

// Background-side handler for the pair message forwarded by the broker content
// script. Performs Supabase `verifyOtp({ token_hash, type: 'magiclink' })` and
// persists the resulting session via `auth-storage.ts`.
//
// Returns `true` from `handle` to keep `sendResponse` async-callable, per
// asbplayer's existing CommandHandler contract.
export default class FlicktionaryPairHandler {
    get sender(): string {
        return 'flicktionary-extension-pair-content';
    }

    get command(): string {
        return 'flicktionary-pair';
    }

    handle(command: Command<Message>, _sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) {
        const msg = command.message;
        if (!isPairMessage(msg)) {
            sendResponse({ ok: false, error: 'Invalid pair payload' });
            return false;
        }

        void (async () => {
            const pending = await getPendingFlicktionaryPairNonce();
            if (!pending || pending.nonce !== msg.nonce) {
                sendResponse({ ok: false, error: 'Pairing nonce was not started by this extension' });
                return;
            }

            try {
                const { data, error } = await getFlicktionarySupabase().auth.verifyOtp({
                    token_hash: msg.tokenHash,
                    type: 'magiclink',
                });

                if (error || !data?.session || !data.user) {
                    sendResponse({ ok: false, error: error?.message ?? 'verifyOtp returned no session' });
                    return;
                }

                await persistSupabaseSession({
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: data.session.expires_at ?? undefined,
                    user: { id: data.user.id, email: data.user.email ?? msg.email },
                });
                sendResponse({ ok: true });
            } catch (error) {
                sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Pairing failed' });
            } finally {
                await clearPendingFlicktionaryPairNonce();
            }
        })();

        return true;
    }
}
