// Per-surface kill switches for the iframe -> Shadow DOM transport migration.
//
// Each injected UI is migrated off `<iframe>` + FrameBridge onto an in-realm
// Shadow DOM render behind its own default-OFF flag, so the migration ships dark
// and is flipped on only for local verification. Once a surface is proven the
// flag is deleted and its in-realm path becomes the only path (mirroring the
// subtitle PoC, whose REACT_SUBTITLE_OVERLAY_ENABLED flag was removed once it
// became the default). These are module-level consts — NOT persisted
// AsbplayerSettings fields (which would trip the export/import unknown-key trap).
export const SHADOW_CONTROLS_OVERLAY_ENABLED = true
export const SHADOW_NOTIFICATION_ENABLED = true
export const SHADOW_VIDEO_DATA_SYNC_ENABLED = true
export const SHADOW_VIDEO_SELECT_ENABLED = false
export const SHADOW_FTUE_ENABLED = false
