export const isIos = () => {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export const isAndroid = () => {
  return /Android/i.test(navigator.userAgent)
}

export const isFacebookNativeWebviewApp = () => {
  // todo this probably works but needs to be tested
  // this might actually work for messenger app too
  const userAgentLowered = navigator.userAgent.toLowerCase()
  const isFacebook = userAgentLowered.includes('fban') || userAgentLowered.includes('fbav')
  return isFacebook
}

export const isInstagramWebviewNativeApp = () => {
  const userAgentLowered = navigator.userAgent.toLowerCase()
  // I got this by going to kamil-landing.template-app.dev/yba-admin from the native instagram app and copying the value of navigator.userAgent
  // test on iphone 12 pro max on 2024.10.27:
  // "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 354.0.0.29.90 (iPhone13,4; iOS 17_5_1; en_ES; en-GB; scale=3.00; 1284x2778; 654111336; IABMV/1)"
  // the above string contains the word Instagram, that's why it works
  // the check also works on android
  // tested on Xiaomi Mi 10T Pro on 2024.10.27:
  // "Mozilla/5.0 (Linux; Android 10; M2007J3SG Build/QKQ1.200419.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 Instagram 354.2.0.47.100 Android (29/10; 440dpi; 1080x2180; Xiaomi; M2007J3SG; apollo; qcom; en_US; 655395836)"
  return userAgentLowered.includes('instagram')
}

export const isLinkedInWebviewOnIosNativeApp = () => {
  const userAgentLowered = navigator.userAgent.toLowerCase()
  // I got this by going to kamil-landing.template-app.dev/yba-admin and copying the value of navigator.userAgent
  // tested on iphone 12 pro max on 2024.10.27:
  // "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.3422"
  // the above string contains the word LinkedIn, that's why it works
  // unfortunately on android this string looks like this
  // tested on Xiaomi Mi 10T Pro on 2024.10.27:
  // "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"
  const isLinkedIn = userAgentLowered.includes('linkedin')
  return isLinkedIn && isIos()
}

export const isLinkedinWebviewOnAndroidNativeApp = () => {
  // todo to implement
  return false
}

export const isLinkedinNativeWebview = () => {
  return isLinkedInWebviewOnIosNativeApp() || isLinkedinWebviewOnAndroidNativeApp()
}
