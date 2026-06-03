import { defineConfig } from 'wxt'
import type { PublicPathEntry, ResolvedPublicFile, UserManifest, Wxt } from 'wxt'
import type { Plugin } from 'vite'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

const commonAssets = [{ srcDir: path.resolve(__dirname, '../asbplayer-common/assets'), destDir: 'assets' }]

const moveToPublicAssets = (srcPath: string, destPath: string, files: ResolvedPublicFile[]) => {
  const srcFiles = fs.readdirSync(srcPath)
  for (const file of srcFiles) {
    files.push({
      absoluteSrc: path.resolve(srcPath, file) as string,
      relativeDest: `${destPath}/${file}`,
    })
  }
}

const addToPublicPathsType = (srcPath: string, destPath: string, paths: PublicPathEntry[]) => {
  const srcFiles = fs.readdirSync(srcPath)
  for (const file of srcFiles) {
    paths.push(`${destPath}/${file}`)
  }
}

const commonRoot = path.resolve(__dirname, '../asbplayer-common')

// Escape every non-ASCII code unit in emitted chunks to a \uXXXX sequence.
// WXT's dev bundler (rolldown) emits raw UTF-8 instead of ASCII like esbuild,
// so bundled deps that embed exotic code points leak through. Notably
// fast-xml-parser's XML 1.1 name-char table contains the Unicode non-character
// U+EFFFF; it is well-formed UTF-8, but Chromium's content-script loader
// (base::IsStringUTF8) rejects non-characters with "Could not load file … It
// isn't UTF-8 encoded.", breaking content-script registration in dev. WXT's
// built-in handling (wxt-dev/wxt#353, fixed in 0.20.22) doesn't cover this
// astral case, so escape everything non-ASCII here — exactly what the prod
// esbuild minify pass already does. Uses generateBundle (not renderChunk),
// which is the hook rolldown honours for in-place chunk rewrites.
const escapeNonAscii = (): Plugin => ({
  name: 'escape-non-ascii-content-scripts',
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type === 'chunk' && /[^\x00-\x7f]/.test(chunk.code)) {
        chunk.code = chunk.code.replace(/[^\x00-\x7f]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
      }
    }
  },
})

// The Doppler config selects the environment (see flicktionary-config.ts) —
// `prd` builds (build:prod, zip) get only production origins; every other
// build (dev, dev:tunnel, build:dev) also gets the dev-tunnel/localhost
// extras. Gating on the Doppler config rather than WXT's `mode` keeps
// `build:dev` (production mode, dev_personal config) working against the
// tunnel, while keeping dev hosts out of the store-submitted manifest —
// the Chrome Web Store flags localhost/dev host permissions in review.
const isProdEnvironment = process.env.DOPPLER_CONFIG === 'prd'

// Origins the background needs to call (pairing broker, oRPC backend, Supabase
// auth). Firefox already declares `<all_urls>` so these are folded in there
// transparently; Chrome requires the explicit list to allow extension-origin
// XHRs.
const flicktionaryHostPermissions = [
  'https://api.flicktionary.app/*',
  'https://app.flicktionary.app/*',
  'https://*.supabase.co/*',
  ...(isProdEnvironment
    ? []
    : [
        // dev-tunnel cloudflare hosts (per-developer subdomains)
        'https://*.flicktionary.dev/*',
        'http://localhost:4002/*',
        'http://localhost:4003/*',
        'http://localhost:5174/*',
        'http://127.0.0.1:34321/*',
        'http://127.0.0.1:54321/*',
      ]),
]

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Lingui i18n (see the @rolldown/plugin-babel pass in `vite` below):
  //  - The macro (<Trans>, t`…`, msg`…`) is transformed by a dedicated
  //    @rolldown/plugin-babel pass, NOT @vitejs/plugin-react's `babel` option —
  //    that option silently fails to apply the macro under WXT's Rolldown build,
  //    leaving an `@lingui/react/macro` runtime stub that throws.
  //  - Catalogs are imported as the *compiled* messages.ts, not the raw .po:
  //    @lingui/vite-plugin's .po transform relies on `moduleType: "js"`, which
  //    WXT's build pipeline drops, so .po catalogs bundle empty. Importing the
  //    pre-compiled .ts sidesteps the plugin. Run
  //    `pnpm --filter @flicktionary/i18n lingui:compile` after extracting.
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  webExt: {
    disabled: true,
  },
  vite: () => ({
    resolve: {
      alias: {
        '@asbplayer-fork/common': commonRoot,
      },
    },
    // Keep emitted chunks ASCII so Chromium accepts content scripts in dev;
    // see escapeNonAscii above. The babel pass runs the Lingui macro
    // (<Trans>, t`…`) — a dedicated @rolldown/plugin-babel pass, mirroring
    // apps/web, because @vitejs/plugin-react's babel option does not reliably
    // apply the macro under WXT's Rolldown build.
    // Tailwind v4 (CSS-first, config-less) powers the React video-overlay PoC
    // (ui/video-overlay): its overlay.css entry is imported `?inline` and the
    // generated utilities are adopted into a Shadow DOM, so host-page CSS can't
    // reach them and we escape the global all-`!important` video.css.
    plugins: [tailwindcss(), escapeNonAscii(), babel({ plugins: ['@lingui/babel-plugin-lingui-macro'] })],
    // Compile-time flag for entrypoint options (e.g. the pairing content
    // script's `matches`), where process.env isn't available. Same gate as
    // flicktionaryHostPermissions above: dev-host match patterns count as
    // host permissions in store review, so prd builds must not declare them.
    define: {
      __FLICKTIONARY_DEV_HOSTS__: JSON.stringify(!isProdEnvironment),
    },
    // Also expose VITE_* env vars so the Doppler dev_personal config that
    // already drives apps/web's dev-tunnel mode (VITE_WEB_URL,
    // VITE_API_HOST, VITE_SUPABASE_*, VITE_IS_FOR_TUNNEL) works in the
    // extension's flicktionary-config without renaming everything to
    // WXT_PUBLIC_*.
    envPrefix: ['WXT_', 'VITE_'],
  }),
  zip: {
    sourcesRoot: '..',
    includeSources: ['LICENSE.md'],
  },
  hooks: {
    'build:publicAssets': (wxt: Wxt, files: ResolvedPublicFile[]) => {
      for (const { srcDir, destDir } of commonAssets) {
        moveToPublicAssets(srcDir, destDir, files)
      }
    },
    'prepare:publicPaths': (wxt: Wxt, paths: PublicPathEntry[]) => {
      for (const { srcDir, destDir } of commonAssets) {
        addToPublicPathsType(srcDir, destDir, paths)
      }
    },
  },
  manifest: ({ browser, mode }) => {
    let manifest: UserManifest = {
      name: 'Flicktionary',
      description: '__MSG_extensionDescription__',
      action: { default_title: 'Flicktionary' },
      default_locale: 'en',
      icons: {
        '16': 'icon/icon16.png',
        '48': 'icon/icon48.png',
        '128': 'icon/icon128.png',
      },
      web_accessible_resources: [
        {
          resources: [
            'chunks/*',
            'fonts/*',
            'icon/image.png',
            'netflix-page.js',
            'youtube-page.js',
            'stremio-page.js',
            'tver-page.js',
            'bandai-channel-page.js',
            'amazon-prime-page.js',
            'hulu-page.js',
            'iwanttfc-page.js',
            'disney-plus-page.js',
            'apps-disney-plus-page.js',
            'viki-page.js',
            'unext-page.js',
            'emby-jellyfin-page.js',
            'osnplus-page.js',
            'bilibili-page.js',
            'nrk-tv-page.js',
            'plex-page.js',
            'areena-yle-page.js',
            'hbo-max-page.js',
            'cijapanese-page.js',
            'page-favicons/*',
          ],
          matches: ['<all_urls>'],
        },
      ],
    }

    let commands: Browser.runtime.Manifest['commands'] = {
      'toggle-video-select': {
        suggested_key: {
          default: 'Ctrl+Shift+F',
          mac: 'MacCtrl+Shift+F',
        },
        description: '__MSG_shortcutSelectSubtitleTrackDescription__',
      },
    }

    if (mode === 'development') {
      commands['wxt:reload-extension'] = {
        description: 'Reload the extension during development',
        // Normally there is a suggested key for this, but Chrome only supports up to 4 suggested keys.
        // suggested_key: {
        //     default: 'Alt+R',
        // },
      }
    }

    let permissions = ['tabs', 'storage', 'unlimitedStorage']

    if (browser === 'chrome') {
      permissions = [...permissions, 'activeTab', 'contextMenus']

      manifest = {
        ...manifest,
        minimum_chrome_version: '116',
        host_permissions: flicktionaryHostPermissions,
        commands,
      }

      if (mode === 'development') {
        // Pins the extension ID for local unpacked builds. The Chrome Web Store
        // rejects uploads whose manifest contains `key` (the store owns it).
        manifest.key =
          'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxmdAa3ymqAjLms43ympXqtyuJnC2bSYh70+5ZZmtyx/MsnGhTEdfbqtsp3BKxHbv0rPd49+Joacm1Shik5/mCppZ0h4I4ISMm983X01H6p/hfAzQYAcnvw/ZQNHAv1QgY9JiuyTBirCDoYB50Fxol/kI/0EviYXuX83KoYpjB0VGP/ssY9ocT//fQUbRmeLDJnciry8y6MduWXHzseOP99axQIjeVsNTE30L4fRN+ppX3aOkG/RFJNx0eI02qbLul3qw5dUuBK5GgMbYftwjHnDoOegnZYFr1sxRO1zsgmxdp/6du75RiDPRJOkPCz2GTrw4CX2FCywbDZlqaIpwqQIDAQAB'
      }
    }

    if (browser === 'firefox') {
      permissions = [...permissions, 'contextMenus', 'clipboardWrite']

      manifest = {
        ...manifest,
        host_permissions: ['<all_urls>'],
        commands,
        // about:addons shows the developer/homepage from here while unsigned;
        // once published, AMO's listing data takes over.
        homepage_url: 'https://app.flicktionary.app',
        developer: {
          name: 'Flicktionary',
          url: 'https://app.flicktionary.app',
        },
        browser_specific_settings: {
          gecko: {
            // Flicktionary's own add-on ID. Deliberately NOT the upstream
            // asbplayer GUID — reusing it made about:addons display asbplayer's
            // AMO listing (description, author, rating), and AMO would reject
            // an upload under a taken ID anyway.
            id: 'extension@flicktionary.app',
          },
        },
      }
    }

    return {
      ...manifest,
      permissions,
    }
  },
})
