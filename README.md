# PTP Soccer - Mobile App

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

1. Clone the repository:
```bash
git clone <repository-url>
cd ptp-mobile-app
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
