// As explained here: https://lingui.dev/ref/metro-transformer
declare module '*.po' {
  import type { Messages } from '@lingui/core'
  export const messages: Messages
}
