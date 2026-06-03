declare module 'm3u8-parser'
declare module 'mpd-parser'

// Compile-time flag injected via `define` in wxt.config.ts: true unless the
// build runs under the `prd` Doppler config. Gates dev-host content-script
// match patterns out of store-submitted builds.
declare const __FLICKTIONARY_DEV_HOSTS__: boolean
