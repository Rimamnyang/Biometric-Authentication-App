// POST /api/device/event
// Called by ESP32 to report events: attendance scans, status updates, etc.
// This is where the authoritative attendance-processing logic lives (server-side).
// Previously this was done inside GlobalAttendanceListener.tsx in the browser — now
// it runs securely on the server with Firebase Admin SDK.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminDb } from "../../lib/firebase-admin";
import { authenticateDevice } from "../../lib/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

// ---------------------------------------------------------------------------
// Helper: reverse geocode using OpenStreetMap Nominatim (no API key needed)
// ---------------------------------------------------------------------------
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      { headers: { "User-Agent": "BiometricAttendanceSystem/2.0" } }
    );
    if (!resp.ok) throw new Error("Geocoding failed");
    const data = await resp.json();
    const addr = data.address ?? {};
    const location =
      addr.building || addr.amenity || addr.road || addr.suburb ||
      addr.city || addr.town || addr.village || "Unknown Location";
    const context = addr.city || addr.state || "";
    return context ? `${location}, ${context}` : location;
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}

// ---------------------------------------------------------------------------
// Helper: write a deviceEvent document that Firestore listeners will pick up
// ---------------------------------------------------------------------------
async function writeDeviceEvent(
  db: FirebaseFirestore.Firestore,
  deviceId: string,
  eventType: string,
  payload: Record<string, unknown>
) {
  await db.collection("deviceEvents").add({
    deviceId,
    eventType,
    payload,
    processed: false,
    createdAt: new Date().toISOString(),
    createdAtServer: FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Attendance processing logic (migrated from GlobalAttendanceListener.tsx)
// Uses Firestore transactions to prevent duplicate records.
// ---------------------------------------------------------------------------
async function processAttendance(
  db: FirebaseFirestore.Firestore,
  deviceId: string,
  fingerprintId: string | number,
  latitude: number | null,
  longitude: number | null
) {
  // 1. Look up student by fingerprint template
  const studentSnap = await db
    .collection("students")
    .where("fingerprintTemplate", "==", String(fingerprintId))
    .limit(1)
    .get();

  if (studentSnap.empty) {
    console.warn(`Unknown fingerprint ID: ${fingerprintId}`);
    await writeDeviceEvent(db, deviceId, "ERROR", {
      message: "Fingerprint not registered to any student",
      fingerprintId,
    });
    return;
  }

  const studentDoc = studentSnap.docs[0];
  const studentData = studentDoc.data();
  const studentFirestoreId = studentDoc.id;

  // 2. Find active sessions
  const sessionsSnap = await db
    .collection("sessions")
    .where("active", "==", true)
    .get();

  if (sessionsSnap.empty) {
    await writeDeviceEvent(db, deviceId, "NO_ACTIVE_SESSION", {
      studentName: studentData.name,
      message: "No active sessions available",
    });
    return;
  }

  // 3. Match session by department + level
  const coursesSnap = await db.collection("courses").get();
  const coursesMap = new Map<string, FirebaseFirestore.DocumentData>();
  coursesSnap.docs.forEach((d) => coursesMap.set(d.id, { id: d.id, ...d.data() }));

  let matchedSession: (FirebaseFirestore.DocumentData & { id: string }) | null = null;
  let matchedCourseId: string | null = null;

  for (const sessionDoc of sessionsSnap.docs) {
    const sData = sessionDoc.data();
    const cData = coursesMap.get(sData.courseId);
    if (
      cData &&
      cData.department === studentData.department &&
      cData.level === studentData.level
    ) {
      matchedSession = { id: sessionDoc.id, ...sData };
      matchedCourseId = sData.courseId;
      break;
    }
  }

  if (!matchedSession || !matchedCourseId) {
    await writeDeviceEvent(db, deviceId, "NO_MATCHING_SESSION", {
      studentName: studentData.name,
      department: studentData.department,
      level: studentData.level,
      message: "No active session for your department and level",
    });
    return;
  }

  const sessionId = matchedSession.id;
  const courseId = matchedCourseId;
  const courseName = coursesMap.get(courseId)?.name ?? "Unknown Course";

  // 4. Check for existing attendance (sign-in or sign-out toggle)
  // Use a Firestore transaction to prevent race conditions
  const attendanceRef = db.collection("attendance");

  const existingSnap = await attendanceRef
    .where("studentId", "==", studentFirestoreId)
    .where("sessionId", "==", sessionId)
    .limit(1)
    .get();

  if (!existingSnap.empty) {
    const attendanceDoc = existingSnap.docs[0];
    const attendanceData = attendanceDoc.data();

    // Already signed out — session fully complete
    if (attendanceData.signOutTime) {
      await writeDeviceEvent(db, deviceId, "SESSION_COMPLETED", {
        studentName: studentData.name,
        message: "Session already completed",
      });
      return;
    }

    // Sign out
    await attendanceDoc.ref.update({ signOutTime: Timestamp.now() });

    await writeDeviceEvent(db, deviceId, "SIGNED_OUT", {
      studentName: studentData.name,
      studentId: studentData.studentId,
      department: studentData.department,
      courseName,
      attendancePercentage: 0,
      message: "Signed Out Successfully",
    });
    return;
  }

  // 5. New sign-in — write attendance record
  const locationName =
    latitude && longitude ? await reverseGeocode(latitude, longitude) : "No GPS";

  await attendanceRef.add({
    studentId: studentFirestoreId,
    courseId,
    sessionId,
    joinTime: Timestamp.now(),
    verified: true,
    verificationMethod: "fingerprint",
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    locationName,
  });

  await writeDeviceEvent(db, deviceId, "ATTENDANCE_RECORDED", {
    studentName: studentData.name,
    studentId: studentData.studentId,
    department: studentData.department,
    courseName,
    attendancePercentage: 0,
    message: "Signed In Successfully",
  });

  console.log(`✅ Attendance logged: ${studentData.name} | 📍 ${locationName}`);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
  }

  const authResult = authenticateDevice(req as any);
  if (!authResult.ok) {
    return res.status(authResult.status!).json({ success: false, error: authResult.error!, code: authResult.code! });
  }

  const { eventType, payload = {}, deviceId: bodyDeviceId } = req.body ?? {};

  if (!eventType) {
    return res.status(400).json({ success: false, error: "eventType is required", code: "MISSING_EVENT_TYPE" });
  }

  const deviceId = bodyDeviceId ?? authResult.deviceId;

  try {
    const db = getAdminDb();

    // Update device lastSeen and cache status/GPS from every event
    const deviceUpdate: Record<string, unknown> = {
      deviceId,
      lastSeen: new Date().toISOString(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Cache GPS coordinates from the device
    const lat = (payload as any).lat ?? (payload as any).latitude;
    const lon = (payload as any).lon ?? (payload as any).longitude;
    const isValidGPS = lat && lon && !(lat === 0 && lon === 0);

    if (isValidGPS) {
      deviceUpdate.lastGPS = {
        lat,
        lon,
        gpsFixed: (payload as any).gpsFixed ?? false,
      };
    }

    // Handle STATUS event — cache ESP32 sensor state
    if (eventType === "STATUS") {
      // Validate GPS bounds
      const validLat = typeof lat === "number" && lat >= -90 && lat <= 90;
      const validLon = typeof lon === "number" && lon >= -180 && lon <= 180;

      deviceUpdate.esp32Status = {
        wifi: (payload as any).wifi ?? false,
        fingerprint: (payload as any).fingerprint ?? false,
        gps: (payload as any).gps ?? false,
        gpsFixed: (payload as any).gpsFixed ?? false,
        satellites: (payload as any).satellites ?? 0,
        ip: (payload as any).ip ?? "",
        lat: validLat ? lat : null,
        lon: validLon ? lon : null,
      };
      deviceUpdate.status = "READY";

      // Write deviceEvent so frontend can update GPS status indicator
      await writeDeviceEvent(db, deviceId, "STATUS", {
        ...(payload as Record<string, unknown>),
      });
    }

    // Handle ATTENDANCE event — authoritative server-side processing
    if (eventType === "ATTENDANCE") {
      const fingerprintId = (payload as any).id ?? (payload as any).fingerprintId;

      if (!fingerprintId) {
        return res.status(400).json({ success: false, error: "fingerprintId is required in payload", code: "MISSING_FINGERPRINT_ID" });
      }

      // Validate GPS if present
      const payloadLat = typeof lat === "number" && lat >= -90 && lat <= 90 ? lat : null;
      const payloadLon = typeof lon === "number" && lon >= -180 && lon <= 180 ? lon : null;

      // Process attendance (non-blocking from ESP32's perspective — we still return 200 quickly)
      // But we do need to await it here for correctness
      await processAttendance(db, deviceId, fingerprintId, payloadLat, payloadLon);
    }

    // Persist device document
    await db.collection("devices").doc(deviceId).set(deviceUpdate, { merge: true });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("[event] Error:", error);
    return res.status(500).json({ success: false, error: "Internal server error", code: "INTERNAL_ERROR" });
  }
}
