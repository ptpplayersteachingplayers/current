# PTP — Players Teaching Players

Year-round group and private soccer training: the platform, the portals, and
what is left of the WordPress site it is replacing.

```bash
./test.sh        # 180 assertions: the database, the webhook, the portals
```

## What is here

```
supabase/        the platform — schema, rules, RLS, edge functions
web/             the portals — booking, parent, trainer
wordpress/       the current live site, frozen for new logic
src/, App.tsx    the Expo mobile app, still pointing at WordPress
```

### `supabase/` — where the rules live

Thirty-four tables, seventy-two policies, and every business rule expressed as
a database function rather than as application code. Capacity, activation,
credits, cancellation, trainer blocks and pay are settled inside the
transaction that writes the row, because two parents can tap Book in the same
second and that race can only be settled in one place.

Eight edge functions sit on top, thin on purpose. The Stripe webhook — not the
browser's success page — is what turns a payment into a place.

See `supabase/README.md`.

### `web/` — three screens, no build step

The booking page, the family's account and the trainer's day. Plain modules and
one stylesheet, so they load on a phone at the side of a pitch. They hold no
business rules: every price and capacity decision arrives from the server.

See `web/README.md`.

### `wordpress/` — still live, deliberately still

The private-training system that is running today. It keeps running until the
new platform is proven. **No new business logic goes in here** — no scheduling,
packages, capacity, credits or automation. See `wordpress/DECOMMISSION.md` for
what comes off and in what order, and `supabase/docs/PHASE-0-AUDIT.md` for what
was found in it.

### The mobile app

Expo and React Native, and still talking to the WordPress REST API. Repointing
it at Supabase is not done. Until it is, it is a fourth client of the old
system rather than a client of the new one, and it is listed here so that is
not a surprise.

## Where things stand

| | Built | Executed |
|---|---|---|
| Schema, RLS, business rules | yes | 71 assertions, PostgreSQL 16 |
| Stripe signature verification | yes | 12 assertions, the real source under Node |
| Edge function handlers | yes | **no** — no Deno runtime or Stripe account here |
| Portal logic | yes | 61 assertions |
| Portals, rendered | yes | 36 assertions, real Chromium |
| Payment step | yes | **no** — needs a real `client_secret` |
| Quo, HubSpot, the AI agent | no | — |

The two "no"s are the honest limit of what has been proven. Everything else in
that table has been run.

## Running the tests

```bash
./test.sh
```

Needs PostgreSQL 16 (with `pgcrypto`, `citext`, `btree_gist`) and Node 22.6 or
newer. `npm i playwright` adds the browser tests; without it they are skipped
loudly rather than silently.

```bash
node web/tests/screenshots.mjs ./shots     # look at the portals, don't just assert
```

---

# Appendix: the Expo mobile app

A production-ready **Expo (React Native)** mobile application for **Players Teaching Players (PTP) Soccer Camps**, built on top of an existing WordPress backend.

## Overview

PTP Soccer allows parents to:
- Browse and register for summer camps and winter clinics
- Find and connect with private trainers (NCAA & pro players)
- View their child's upcoming schedule
- Receive push notifications for reminders

## Tech Stack

### Mobile App
- **Expo** (React Native)
- **TypeScript** - Full type safety throughout
- **React Navigation** - Stack + Bottom Tabs
- **Axios** - HTTP client with interceptors
- **expo-secure-store** - Secure JWT token storage
- **expo-notifications** - Push notifications

### Backend
- **WordPress** + **WooCommerce** (existing site)
- **JWT Authentication for WP REST API** (plugin)
- **PTP Mobile API** (custom plugin included)

## Project Structure

```
├── App.tsx                    # Entry point
├── src/
│   ├── api/
│   │   └── client.ts          # Axios client with auth interceptors
│   ├── components/
│   │   ├── Badge.tsx
│   │   ├── Card.tsx
│   │   ├── EmptyState.tsx
│   │   ├── ErrorState.tsx
│   │   ├── LoadingScreen.tsx
│   │   └── PrimaryButton.tsx
│   ├── context/
│   │   └── AuthContext.tsx    # Authentication state management
│   ├── navigation/
│   │   └── index.tsx          # Navigation configuration
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── CampsScreen.tsx
│   │   ├── CampDetailScreen.tsx
│   │   ├── TrainersScreen.tsx
│   │   ├── TrainerDetailScreen.tsx
│   │   ├── ScheduleScreen.tsx
│   │   └── ProfileScreen.tsx
│   ├── theme/
│   │   └── index.ts           # PTP brand colors and tokens
│   ├── types/
│   │   └── index.ts           # TypeScript interfaces
│   └── utils/
│       └── notifications.ts   # Push notification helpers
└── wordpress-plugin/
    └── ptp-mobile-api/
        ├── ptp-mobile-api.php # WordPress REST API plugin
        └── uninstall.php
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- Expo Go app on your phone (for testing)

### Installation

1. Clone the repository **and make sure you are inside the folder that contains `package.json`** (Windows zip extractions sometimes add an extra top-level folder):
```bash
git clone <repository-url>
# If you downloaded a .zip, open it and ensure you `cd` into the folder where package.json lives
cd ptp-mobile-app
dir /b   # (Windows) confirm package.json is listed here
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Scan the QR code with Expo Go (Android) or Camera app (iOS)

### If you see `PlatformConstants` or TurboModule errors in Expo Go

These errors almost always mean your local React Native version does not match the Expo SDK bundled in Expo Go. Fixes:

1. Verify dependencies are pinned to Expo SDK 54 (see `package.json` — `react-native@0.77.x`, `react@18.3.x`, `expo@~54.0.0`).
2. Re-install modules after updating: `npm install --legacy-peer-deps`.
3. Clear caches before starting Metro: `npx expo start -c`.
4. If you previously unzipped the project into another folder, ensure you run commands from the folder that actually contains `package.json`.

### WordPress Setup

1. Upload the `wordpress-plugin/ptp-mobile-api` folder to `/wp-content/plugins/`
2. Activate "PTP Mobile API" in WordPress admin
3. Ensure "JWT Authentication for WP REST API" plugin is installed and configured

## Brand Guidelines

### Colors
- **PTP Yellow** (Primary): `#FCB900`
- **Ink Black** (Text): `#0E0F11`
- **Off-White** (Background): `#F4F3F0`
- **Gray** (Secondary text): `#6B7280`
- **Border**: `#E5E7EB`

### UI Style
- Clean, modern, sports-brand feel
- High contrast (yellow on black, black on off-white)
- Rounded corners (~16px radius)
- Generous spacing

## API Endpoints

The PTP Mobile API plugin provides these endpoints:

| Method | Endpoint | Auth Required | Description |
|--------|----------|---------------|-------------|
| POST | `/wp-json/jwt-auth/v1/token` | No | Get JWT token |
| GET | `/wp-json/ptp/v1/me` | Yes | Current user info |
| GET | `/wp-json/ptp/v1/camps` | No | List camps & clinics |
| GET | `/wp-json/ptp/v1/trainers` | No | List trainers |
| GET | `/wp-json/ptp/v1/sessions` | Yes | User's schedule |
| POST | `/wp-json/ptp/v1/devices` | Yes | Register push token |

## Features

### Authentication
- JWT-based authentication
- Secure token storage with expo-secure-store
- Automatic token refresh handling
- Clean logout with token cleanup

### Error Handling
- Centralized Axios interceptors
- Friendly error messages
- Automatic 401 handling (logout on session expiry)
- Retry buttons on all error states

### Loading States
- Full-screen loading indicators
- Pull-to-refresh on all lists
- Skeleton states for better UX

### Push Notifications
- Permission request flow
- Expo push token registration
- Device token storage on backend

## Development

### Type Checking
```bash
npm run type-check
```

### Linting
```bash
npm run lint
```

### Building for Production
```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## License

Proprietary - Players Teaching Players

## Support

For questions or issues, contact info@ptpsummercamps.com
