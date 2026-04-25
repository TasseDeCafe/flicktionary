const IS_DEV = process.env.APP_VARIANT === 'development'
const IS_PREVIEW = process.env.APP_VARIANT === 'preview'

export const getUniqueIosIdentifier = () => {
  if (IS_DEV) {
    return 'com.app-monorepo-template.ios.dev'
  }
  if (IS_PREVIEW) {
    return 'com.app-monorepo-template.ios.preview'
  }
  return 'com.app-monorepo-template.ios'
}

export const getUniqueAndroidIdentifier = () => {
  if (IS_DEV) {
    return 'com.app.monorepo.template.android.dev'
  }
  if (IS_PREVIEW) {
    return 'com.app.monorepo.template.android.preview'
  }
  return 'com.app.monorepo.template.android'
}

const getAppName = () => {
  if (IS_DEV) {
    return 'DEV - TemplateApp'
  }
  if (IS_PREVIEW) {
    return 'PREVIEW - TemplateApp'
  }
  return 'TemplateApp'
}

const getAppHost = () => {
  if (IS_DEV) {
    return '*.app-monorepo-template.dev'
  }
  return 'app.app-monorepo-template.dev'
}

const getAssociatedDomains = () => {
  const productionDomains = ['applinks:app.app-monorepo-template.dev']
  if (IS_DEV) {
    return [
      ...productionDomains,
      'applinks:web-kamil.app-monorepo-template.dev',
      'applinks:web-sebastien.app-monorepo-template.dev',
    ]
  }
  return productionDomains
}

const getGoogleIosUrlScheme = () => {
  if (IS_DEV) {
    return 'com.googleusercontent.apps.448646365340-dltp0msngf9n2sh6jcqaehm5ni6f9jlf'
  }
  if (IS_PREVIEW) {
    return `ADD_PREVIEW_CLIENT_ID_IF_NEEDED`
  }
  return 'com.googleusercontent.apps.448646365340-8noc510qrjbu8nu7pt648ru4bu4a4nr4'
}

const config = {
  expo: {
    name: getAppName(),
    owner: 'template-organization',
    slug: 'template-app',
    version: '0.0.3',
    orientation: 'portrait',
    icon: './src/assets/images/icon.png',
    scheme: 'template-app',
    userInterfaceStyle: 'automatic',
    buildCacheProvider: 'eas',
    ios: {
      usesAppleSignIn: true,
      supportsTablet: false,
      bundleIdentifier: getUniqueIosIdentifier(),
      associatedDomains: getAssociatedDomains(),
      universalLinks: {
        paths: ['/login/email/verify', '(auth)/login/email/verify', '/login/email/*', '(auth)/login/email/*'],
      },
      infoPlist: {
        CFBundleURLTypes: [
          {
            CFBundleURLSchemes: [
              // See https://docs.expo.dev/guides/google-authentication/
              getGoogleIosUrlScheme(),
            ],
          },
        ],
        ITSAppUsesNonExemptEncryption: false,
      },
      // this is required by Apple for Sentry: https://docs.sentry.io/platforms/react-native/data-management/apple-privacy-manifest/
      privacyManifests: {
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePerformanceData',
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
          },
          {
            NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
          },
        ],
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
            NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
          },
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
            NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
          },
          {
            NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
            NSPrivacyAccessedAPITypeReasons: ['C617.1'],
          },
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './src/assets/images/adaptive-icon.png',
      },
      package: getUniqueAndroidIdentifier(),
      // based on https://youtu.be/kNbEEYlFIPs?si=RbYz1SDifW8iTqJj&t=608
      intentFilters: [
        // https://docs.expo.dev/linking/android-app-links/
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            {
              scheme: 'https',
              host: getAppHost(),
              pathPrefix: '/login/email/verify',
            },
          ],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
      androidNavigationBar: {
        enforceContrast: true,
      },
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './src/assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-splash-screen',
        {
          image: './src/assets/images/splash-icon.png',
          resizeMode: 'cover',
        },
      ],
      [
        '@react-native-google-signin/google-signin',
        {
          // See https://react-native-google-signin.github.io/docs/setting-up/expo
          iosUrlScheme: getGoogleIosUrlScheme(),
        },
      ],
      ['expo-apple-authentication'],
      [
        '@sentry/react-native/expo',
        {
          url: 'https://sentry.io/',
          project: 'native',
          organization: 'template-organization',
        },
      ],
      ['expo-font'],
      ['expo-localization'],
    ],
    experiments: {
      typedRoutes: true,
      autolinkingModuleResolution: true,
      reactCompiler: true,
    },
    updates: {
      url: 'https://u.expo.dev/20a5774f-5cfd-48ad-b277-50d9d02a2e58',
    },
    runtimeVersion: {
      policy: 'appVersion',
    },
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: '20a5774f-5cfd-48ad-b277-50d9d02a2e58',
      },
    },
  },
}

export default config
