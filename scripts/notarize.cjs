// macOS notarization hook (runs via electron-builder `afterSign`).
//
// No-op unless ENVY_NOTARIZE=1, so bare `npm run package` stays fast for local
// iteration and doesn't fail without credentials. The distribution scripts —
// `release`, `package:all`, `package:dist` — and the CI release workflow set
// ENVY_NOTARIZE=1, so release builds are always notarized.
//
// Credentials come from one of two places:
//   - CI: APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID env vars
//     (set as GitHub Actions secrets — see .github/workflows/release.yml)
//   - Local: the `envy-notarize` keychain profile, created once with
//     `xcrun notarytool store-credentials envy-notarize \
//        --apple-id <you@example.com> --team-id <TEAMID> --password <app-specific-pw>`
const path = require('path');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin' || process.env.ENVY_NOTARIZE !== '1') return;

  const { notarize } = require('@electron/notarize');
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  const useEnv = APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD && APPLE_TEAM_ID;
  const credentials = useEnv
    ? { appleId: APPLE_ID, appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD, teamId: APPLE_TEAM_ID }
    : { keychainProfile: 'envy-notarize' };

  console.log(`  • notarizing ${appPath} credentials=${useEnv ? 'env' : 'keychainProfile:envy-notarize'}`);
  await notarize({ appPath, ...credentials });
  console.log('  • notarized');
};
