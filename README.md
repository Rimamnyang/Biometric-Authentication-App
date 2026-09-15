# 🔬 Biometric Attendance System

A full-stack biometric attendance management platform that uses an **ESP32 microcontroller** with a fingerprint sensor and GPS module to record student attendance in real time. The web dashboard is built with **React + TypeScript**, backed by **Firebase**, and communicates with hardware via a local **WebSocket bridge server**.

---

## ✨ Features

- **Fingerprint-based check-in/check-out** — students scan their finger on the ESP32 device; attendance is logged automatically
- **GPS location tagging** — each attendance record captures the GPS coordinates from the device at the time of scan
- **Real-time updates** — the dashboard and fingerprint portal receive live events via WebSocket; no page refresh needed
- **Exam verification portal** — a separate public-facing page for verifying student identity during exams
- **Admin dashboard** with dedicated sections for:
  - Student management (enroll, edit, delete, fingerprint capture)
  - Course management
  - Session management (open / close attendance sessions)
  - Attendance log with location names resolved via geocoding
  - Attendance analytics (per-student percentage breakdown)
- **Hardware bridge server** — a Node.js WebSocket server that sits between the browser and the ESP32, forwarding commands and relaying events
- **Firebase Auth** — admin login with email/password; protected routes
- **GitHub Pages deployment** ready via `gh-pages`

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│              React Web App (Vite)               │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Dashboard│  │Fingerprint│  │Exam           │  │
│  │ (Admin)  │  │ Portal    │  │Verification   │  │
│  └────┬─────┘  └─────┬────┘  └──────┬────────┘  │
└───────┼──────────────┼──────────────┼────────────┘
        │              │              │
        │         WebSocket (ws://localhost:5000)
        │              │
┌───────▼──────────────▼──────────────────────────┐
│         Fingerprint Bridge Server (Node.js)      │
│              fingerprint-bridge-server/          │
└───────────────────────┬─────────────────────────┘
                        │ WebSocket (ws://<ESP32_IP>:8080)
┌───────────────────────▼─────────────────────────┐
│                  ESP32 Device                    │
│   Fingerprint Sensor + GPS Module               │
└─────────────────────────────────────────────────┘
        │
        │  Firestore reads/writes
        ▼
┌────────────────────┐
│  Firebase          │
│  ├── Auth          │
│  └── Firestore DB  │
└────────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 6 |
| Routing | React Router DOM v7 |
| Backend / Database | Firebase (Auth + Firestore) |
| Icons | Lucide React |
| Hardware Bridge | Node.js, `ws` (WebSocket) |
| Deployment | GitHub Pages (`gh-pages`) |
| Hardware | ESP32, R307/R503 Fingerprint Sensor, GPS Module |

---

## 📁 Project Structure

```
fixed-fingerprint-auth/
├── components/                  # React UI components
│   ├── Dashboard.tsx            # Main admin dashboard with sidebar nav
│   ├── StudentManagement.tsx    # CRUD for students + fingerprint enrollment
│   ├── CourseManagement.tsx     # Add/edit/delete courses
│   ├── SessionManagement.tsx    # Open/close attendance sessions per course
│   ├── AttendanceLog.tsx        # View all attendance records with location
│   ├── AttendanceAnalytics.tsx  # Per-student attendance stats
│   ├── FingerprintPortal.tsx    # Student-facing scan terminal
│   ├── ExamVerification.tsx     # Exam ID verification page
│   ├── GlobalAttendanceListener.tsx  # Real-time WS listener (app-wide)
│   ├── ServerStatus.tsx         # Bridge server + ESP32 health display
│   ├── AccessCard.tsx           # Animated card shown after successful scan
│   ├── Login.tsx                # Admin login page
│   └── ...                      # Modals, toasts, shared UI
├── context/
│   └── AuthContext.tsx          # Firebase auth context + admin profile
├── services/
│   ├── firebase.ts              # Firebase app initialisation
│   └── geocoding.ts             # Reverse geocoding (lat/lon → location name)
├── fingerprint-bridge-server/   # Standalone Node.js WebSocket bridge
│   ├── server.js                # Bridge server entry point
│   └── package.json
├── types.ts                     # Shared TypeScript interfaces
├── App.tsx                      # App router + auth provider
├── index.html
├── vite.config.ts
└── .env                         # Firebase credentials (see setup)
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- A **Firebase project** (Firestore + Authentication enabled)
- An **ESP32** flashed with the companion firmware (WebSocket server on port `8080`)

### 1. Clone the repository

```bash
git clone https://github.com/coder-real/biometric-attendance-system.git
cd biometric-attendance-system
```

### 2. Install frontend dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root (copy the template below):

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

> **Never commit your `.env` file.** Add it to `.gitignore`.

### 4. Configure the bridge server

Open `fingerprint-bridge-server/server.js` and update the ESP32 IP:

```js
const ESP32_IP = "192.168.x.x";  // ← your ESP32's local IP address
const ESP32_PORT = 8080;
```

### 5. Install bridge server dependencies

```bash
cd fingerprint-bridge-server
npm install
cd ..
```

---

## ▶️ Running Locally

You need to run **two processes** simultaneously:

**Terminal 1 — Frontend dev server:**
```bash
npm run dev
```
The app will be available at `http://localhost:5173`.

**Terminal 2 — Bridge server:**
```bash
cd fingerprint-bridge-server
node server.js
```
The bridge listens on `ws://localhost:5000` and connects to the ESP32.

---

## 🌐 Pages & Routes

| Route | Description | Auth Required |
|---|---|---|
| `/login` | Admin login | No |
| `/dashboard` | Admin panel (students, courses, sessions, logs) | **Yes** |
| `/portal` | Fingerprint scan terminal (student-facing) | No |
| `/verify` | Exam identity verification | No |

---

## 🔌 WebSocket Protocol

The bridge server (`ws://localhost:5000`) accepts the following commands from web clients:

| Command | Description |
|---|---|
| `CAPTURE_FINGERPRINT` | Enroll a new fingerprint on the ESP32 |
| `VERIFY_FINGERPRINT` | Verify a finger against stored templates |
| `DELETE_FINGERPRINT:<id>` | Delete template by ID |
| `CLEAR_ALL_FINGERPRINTS` | Wipe all stored templates |
| `GET_STATUS` | Request current ESP32 sensor/GPS status |

The server broadcasts the following event types back to all web clients:

| Event type | Description |
|---|---|
| `ESP32_CONNECTION` | ESP32 connected/disconnected |
| `ESP32_STATUS` | Sensor status, GPS fix, satellite count |
| `ATTENDANCE` | A finger was scanned with GPS coordinates |
| `ENROLL_RESPONSE` | Result of a fingerprint enrollment |
| `VERIFY_RESPONSE` | Result of a fingerprint verification |
| `DELETE_RESPONSE` | Result of a template deletion |
| `CLEAR_ALL_RESPONSE` | Result of clearing all templates |

---

## 🗄️ Firestore Data Model

```
admins/{uid}
  └── name, email, role

students/{id}
  └── studentId, name, department, level, fingerprintTemplate

courses/{id}
  └── name, code, department, level

courseStudents/{id}
  └── courseId, studentId

sessions/{id}
  └── courseId, startTime, endTime, active

attendance/{id}
  └── studentId, courseId, sessionId, joinTime, signOutTime,
      verified, latitude, longitude, locationName
```

---

## 📦 Deployment

This project is configured to deploy to **GitHub Pages**:

```bash
npm run deploy
```

This runs `vite build` then publishes the `dist/` folder via `gh-pages`.

> The app uses a `HashRouter` so that client-side routes work correctly on GitHub Pages.

---

## 🔒 Security Notes

- Admin routes are protected with Firebase Authentication and a `ProtectedRoute` wrapper.
- The fingerprint portal (`/portal`) and exam verification (`/verify`) are intentionally public — they are designed to run on a dedicated kiosk device.
- Keep your `.env` file private and rotate Firebase keys if they are ever exposed.
- The bridge server is intended to run on a **local network** only. Do not expose port `5000` to the internet.

---

## 📄 License

ISC
