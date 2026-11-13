# Dwellio

Shared household app: meals with announce-by times and adjustable weights, a single shared grocery list, expense splitting with receiver-confirmed settlements, tasks, polls, bills, announcements, a calendar, activity history, and reports. Built with Expo and backed by Firebase Authentication and Firestore.

## Requirements

- Node 20+
- An Expo account with the `dewllio-6290e` Firebase project linked
- For production builds: an Expo access token and an Android signing key (see Releasing)

## Get started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npx expo start
```

Open the project with [Expo Go](https://expo.dev/go) to try it, or build a development client for native modules.

## Useful commands

```bash
npx expo start        # dev server
npx expo lint         # lint
npx tsc --noEmit      # typecheck
npx expo export --platform web   # static web export
```

Before finishing any change, lint and typecheck should both pass.

## Configuration

Copy `.env.example` to `.env.local` and fill it from the Firebase console
(Project settings > General > Your apps > SDK setup and configuration):

- `EXPO_PUBLIC_FIREBASE_*` — web app config for `dewllio-6290e`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` — OAuth web client, used for native Google sign-in
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` — Android OAuth client id

Expo reads `EXPO_PUBLIC_*` variables at startup, so restart the dev server
after changing `.env.local`.

Android native builds use the `com.dwellio.app` package. The SHA-1 of the
signing key must be registered on the Firebase Android app or Google sign-in
fails with a developer error.

## Project layout

- `src/app/` — Expo Router screens. Every file is a route; `(tabs)/` holds the main tabs.
- `src/components/` — shared UI (`ui.tsx`, bottom tab bar).
- `src/lib/` — Firebase setup, auth and household contexts, finance math, invite links.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` — backend config, deployed with `npx -y firebase-tools@latest deploy`.
- `.github/workflows/release.yml` — tag-driven production release.

## Releasing

Push a tag like `v1.2.3` and the release workflow runs: typecheck, lint,
production EAS build, AAB download, conversion to a signed universal APK,
and a GitHub release holding both files.

Required repository secrets:

| Secret | Purpose |
|---|---|
| `EXPO_TOKEN` | Expo access token for the EAS build |
| `ANDROID_KEYSTORE_BASE64` | base64 of the release keystore (`base64 -w0 <keystore>`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Use the same keystore as local builds so the APK installs as an update.
The APK is signed with your key for direct installs; use the attached AAB
for Play Store releases, which carry the EAS upload key.

Note: EAS cloud builds count against your Expo plan, so prefer one build per
release and use Expo Updates for JavaScript-only changes where possible.
