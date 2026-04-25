import {
  isAndroid,
  isFacebookNativeWebviewApp,
  isInstagramWebviewNativeApp,
} from '@template-app/core/utils/browser-utils.ts'

export const shouldShowSignInWithGoogle = () => {
  // Google forbids using sign in with Google on certain native webviews
  // our initial solution to it was to force the user to open his default browser whenever he clicked a link to our landing inside a webview,
  // this unfortunately stopped working (more about it here: https://www.notion.so/grammarians/on-android-instagram-links-to-our-app-open-in-the-instagram-webview-instead-of-opening-the-browser-12c168e7b01a80e596aeea2ccddfdf81 )
  // so we decided to hide Google sign in button on android webviews in the cases where we can do it
  if (isInstagramWebviewNativeApp() && isAndroid()) {
    return false
  }
  if (isFacebookNativeWebviewApp() && isAndroid()) {
    return false
  }
  // todo: check if sign in with Google works on whatsapp, reddit and other apps
  return true
}
