# ESP32 ↔ Vercel API Protocol

This document describes the exact HTTP protocol your ESP32 firmware must implement to communicate with the Vercel-hosted backend.

---

## Base URL

In production, all requests go to your Vercel deployment:

```
https://your-project.vercel.app
```

During local development (with `vercel dev` or `npm run dev`):

```
http://localhost:3000
```

---

## Authentication

Every request from the ESP32 **must** include two headers:

```
Authorization: Bearer <DEVICE_API_KEY>
x-device-id: attendance-device-01
Content-Type: application/json
```

- `DEVICE_API_KEY` is set in Vercel environment variables and flashed into your ESP32 firmware.  
- `x-device-id` identifies which physical device is making the request.  
- Requests without a valid `Authorization` header receive **HTTP 401**.

---

## Endpoints

### 1. Poll for Commands

The ESP32 should call this endpoint every **3–5 seconds** to retrieve the next pending command.

```
GET /api/device/poll?deviceId=attendance-device-01
```

**Headers:**
```
Authorization: Bearer <DEVICE_API_KEY>
x-device-id: attendance-device-01
```

**Success — command available:**
```json
{
  "success": true,
  "command": {
    "id": "abc123",
    "type": "VERIFY_FINGERPRINT",
    "payload": {}
  }
}
```

**Success — no command:**
```json
{
  "success": true,
  "command": null
}
```

**Error (401):**
```json
{
  "success": false,
  "error": "Invalid device API key",
  "code": "INVALID_API_KEY"
}
```

**Command types the ESP32 will receive:**

| type | Action |
|---|---|
| `VERIFY_FINGERPRINT` | Scan finger and match against stored templates |
| `CAPTURE_FINGERPRINT` | Enroll a new fingerprint |
| `DELETE_FINGERPRINT` | Delete template — see `payload.templateId` |
| `CLEAR_ALL_FINGERPRINTS` | Wipe all stored templates |
| `GET_STATUS` | Send a STATUS event with current sensor state |

**After receiving a command**, the ESP32 must:
1. Execute the command
2. Send the result to `/api/device/result`
3. Return to polling

---

### 2. Send Events

Used for **attendance scans** and **status updates**.

```
POST /api/device/event
```

**Headers:**
```
Authorization: Bearer <DEVICE_API_KEY>
x-device-id: attendance-device-01
Content-Type: application/json
```

#### Attendance event (finger scanned in attendance mode)

```json
{
  "deviceId": "attendance-device-01",
  "eventType": "ATTENDANCE",
  "payload": {
    "id": 12,
    "lat": 6.5244,
    "lon": 3.3792,
    "alt": 20.5,
    "gpsFixed": true,
    "gpsAvailable": true,
    "sats": 8
  }
}
```

#### Status event (heartbeat / GET_STATUS response)

```json
{
  "deviceId": "attendance-device-01",
  "eventType": "STATUS",
  "payload": {
    "wifi": true,
    "fingerprint": true,
    "gps": true,
    "gpsFixed": true,
    "satellites": 8,
    "ip": "192.168.1.45",
    "lat": 6.5244,
    "lon": 3.3792
  }
}
```

**Success response:**
```json
{ "success": true }
```

**GPS validation:** latitude must be in `[-90, 90]` and longitude in `[-180, 180]`. Values of `(0, 0)` are treated as invalid and ignored.

---

### 3. Send Command Results

After executing a command received from `/api/device/poll`, the ESP32 must report the outcome.

```
POST /api/device/result
```

**Headers:**
```
Authorization: Bearer <DEVICE_API_KEY>
x-device-id: attendance-device-01
Content-Type: application/json
```

#### Fingerprint verification result

```json
{
  "deviceId": "attendance-device-01",
  "commandId": "abc123",
  "resultType": "VERIFY_RESPONSE",
  "success": true,
  "data": {
    "id": 12,
    "lat": 6.5244,
    "lon": 3.3792,
    "gpsFixed": true
  }
}
```

#### Enrollment result

```json
{
  "deviceId": "attendance-device-01",
  "commandId": "abc123",
  "resultType": "ENROLL_RESPONSE",
  "success": true,
  "data": {
    "id": 13
  }
}
```

#### Enrollment failure

```json
{
  "deviceId": "attendance-device-01",
  "commandId": "abc123",
  "resultType": "ENROLL_RESPONSE",
  "success": false,
  "data": {
    "error": "Finger not placed correctly"
  }
}
```

#### Delete fingerprint result

```json
{
  "deviceId": "attendance-device-01",
  "commandId": "abc123",
  "resultType": "DELETE_RESPONSE",
  "success": true,
  "data": {
    "id": 12
  }
}
```

#### Clear all fingerprints result

```json
{
  "deviceId": "attendance-device-01",
  "commandId": "abc123",
  "resultType": "CLEAR_ALL_RESPONSE",
  "success": true,
  "data": {}
}
```

**Success response:**
```json
{ "success": true }
```

---

### 4. Device Status (frontend use only)

This is called by the React frontend — the ESP32 does not need to use this endpoint.

```
GET /api/device/status
```

---

## Recommended ESP32 Main Loop

```
1.  Connect to Wi-Fi
2.  Every ~30 seconds: POST /api/device/event  (eventType: "STATUS")
3.  Every ~4 seconds:  GET  /api/device/poll
4.  If command returned:
      a. Execute command on hardware
      b. POST /api/device/result  with commandId and result
5.  On any attendance scan (interrupt / physical button):
      a. POST /api/device/event  (eventType: "ATTENDANCE") with GPS data
6.  On network failure: exponential backoff, retry after 5s → 10s → 30s
```

---

## Error Codes

| HTTP Status | code | Meaning |
|---|---|---|
| 400 | `MISSING_FIELDS` | Required JSON field is absent |
| 400 | `INVALID_COMMAND` | Unknown command type |
| 401 | `MISSING_AUTH_HEADER` | No `Authorization` header |
| 401 | `INVALID_API_KEY` | Wrong key |
| 403 | `SERVER_MISCONFIGURATION` | `DEVICE_API_KEY` not set on server |
| 404 | `COMMAND_NOT_FOUND` | `commandId` doesn't exist in Firestore |
| 405 | `METHOD_NOT_ALLOWED` | Wrong HTTP method |
| 500 | `INTERNAL_ERROR` | Server-side error |

---

## Retry Behaviour

- On HTTP 5xx or network timeout: retry after exponential backoff (5s, 10s, 30s, max 60s)
- On HTTP 401: do **not** retry — the key is wrong; check firmware configuration
- On HTTP 429: wait at least 60 seconds before retrying

---

## Security Notes

- `DEVICE_API_KEY` must be stored securely in the ESP32 (e.g. NVS / flash partition, not plain `const char*` in code committed to GitHub)
- All production requests must use **HTTPS** (Vercel provides TLS automatically)
- Never expose `DEVICE_API_KEY` in browser JavaScript or VITE_ environment variables
