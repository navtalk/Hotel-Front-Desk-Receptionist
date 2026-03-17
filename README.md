# NavTalk Hotel Front Desk Receptionist

AI-powered hotel front desk assistant demo using NavTalk's real-time digital human technology. Features live video, speech-to-text transcripts, and natural conversation flow for guest services.

## Getting Started

```bash
cd Hotel-Front-Desk-Receptionist
npm install
# Configure your NavTalk credentials in .env
npm run dev
```

The dev server runs on <http://localhost:5173>.

### Required Environment Variables

| Key | Description |
| --- | --- |
| `VITE_NAVTALK_LICENSE` | NavTalk realtime license key. |
| `VITE_NAVTALK_CHARACTER` | Character name (e.g. `navtalk.Sophia`). Used as fallback if `VITE_NAVTALK_AVATAR_ID` is not set. |
| `VITE_NAVTALK_AVATAR_ID` | **(Optional, Recommended)** Avatar ID for precise lookup. **If set, takes priority over `VITE_NAVTALK_CHARACTER`**. Leave empty to use character name for avatar lookup. |
| `VITE_NAVTALK_VOICE` | Voice preset (e.g. `marin`, `cedar`, `sage`). |
| `VITE_NAVTALK_BASE_URL` | NavTalk transfer origin, defaults to `transfer.navtalk.ai`. |

> **Connection Priority:** The system will use `avatarId` if provided, otherwise falls back to `characterName`. This allows precise avatar selection while maintaining backward compatibility.

> The browser will request microphone and camera permissions the first time you start a NavTalk session.

## Project Structure

- `src/composables/useNavTalkRealtime.ts` – Core WebSocket + WebRTC integration with NavTalk service
- `src/views` – Main application views
- `src/components` – UI components

## Features

- Real-time video chat with AI receptionist
- Speech-to-text transcription
- Natural conversation handling for:
  - Check-in/check-out
  - General inquiries
  - Hotel services information
- Auto-hangup detection

## Building for Production

```bash
npm run build    # type-checks and builds
npm run preview  # preview production build locally
```
