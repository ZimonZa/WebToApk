import type { CapacitorConfig } from '@capacitor/cli';

// This file is a template. Placeholders (__APP_ID__ etc.) are replaced by
// scripts/scaffold.mjs at build time. Do not edit the placeholders by hand.
const config: CapacitorConfig = {
  appId: '__APP_ID__',
  appName: '__APP_NAME__',
  webDir: 'www',
  server: {
    // The live website the app wraps. This is what makes "web -> app" work:
    // the native WebView loads this URL fullscreen on launch.
    url: '__APP_URL__',
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    backgroundColor: '__THEME_COLOR__',
  },
  ios: {
    backgroundColor: '__THEME_COLOR__',
  },
};

export default config;
