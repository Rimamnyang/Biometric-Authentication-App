// FingerprintPortal.tsx
// Replaces ws://localhost:5000 with:
//  - /api/device/command  (to send VERIFY_FINGERPRINT)
//  - Firestore onSnapshot on deviceEvents (to receive results)
//  - Firestore onSnapshot on devices/{id} (for GPS status)

import React, { useState, useEffect, useRef } from "react";
import { db } from "../services/firebase";
import { collection, query, where, getDocs } from "firebase/firestore";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { Course, AccessCardData } from "../types";
import AttendanceCard from "./AttendanceCard";
import StatusModal from "./StatusModal";
import { CheckCircle, XCircle, Fingerprint, Loader, Satellite } from "lucide-react";
import { requestFingerprintVerification } from "../services/deviceApi";

const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";
const ONLINE_THRESHOLD_MS = 60_000;

export default function FingerprintPortal() {
  const [scanState, setScanState] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("Connecting...");
  const [gpsStatus, setGpsStatus] = useState<"searching" | "ready" | "offline">("offline");
  const [cardData, setCardData] = useState<AccessCardData | null>(null);
  const [statusModal, setStatusModal] = useState<{
    isOpen: boolean;
    type: "error" | "warning" | "info";
    title: string;
    message: string;
  }>({ isOpen: false, type: "info", title: "", message: "" });

  const processedEventIds = useRef<Set<string>>(new Set());

  // ── Listen to device document for GPS/online status ───────────────────────
  useEffect(() => {
    const deviceRef = doc(db, "devices", DEVICE_ID);
    const unsub = onSnapshot(deviceRef, (snap) => {
      if (!snap.exists()) {
        setGpsStatus("offline");
        setStatusMessage("Device offline");
        return;
      }
      const data = snap.data();
      const lastSeen: string | null = data?.lastSeen ?? null;
      const online = lastSeen
        ? Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS
        : false;

      if (!online) {
        setGpsStatus("offline");
        setStatusMessage("Device offline");
        return;
      }

      const esp32 = data?.esp32Status ?? {};
      const hasFix = esp32.gpsFixed === true && (esp32.satellites ?? 0) > 0;
      if (hasFix) {
        setGpsStatus("ready");
        setStatusMessage("Ready to authenticate");
      } else {
        setGpsStatus("searching");
        setStatusMessage("Syncing Satellite Data...");
      }
    });
    return () => unsub();
  }, []);

  // ── Listen for deviceEvents to handle scan results ────────────────────────
  useEffect(() => {
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    const q = query(
      collection(db, "deviceEvents"),
      where("deviceId", "==", DEVICE_ID),
      where("processed", "==", false)
    );

    const unsub = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== "added" && change.type !== "modified") continue;
        const eventDoc = change.doc;
        const event = { id: eventDoc.id, ...eventDoc.data() } as any;

        if (processedEventIds.current.has(event.id)) continue;
        if (event.createdAt < cutoff) continue;
        processedEventIds.current.add(event.id);

        const p = event.payload ?? {};

        switch (event.eventType) {
          case "ATTENDANCE_RECORDED":
            setScanState("success");
            setStatusMessage("Signed In");
            setCardData({
              name: p.studentName ?? "Student",
              studentId: p.studentId ?? "N/A",
              department: p.department ?? "N/A",
              courseName: p.courseName ?? "Course",
              attendancePercentage: p.attendancePercentage ?? 0,
              status: "entry",
            });
            break;

          case "SIGNED_OUT":
            setScanState("success");
            setStatusMessage(`${p.studentName}: Signed Out`);
            setCardData({
              name: p.studentName,
              studentId: p.studentId,
              department: p.department,
              courseName: p.courseName,
              attendancePercentage: p.attendancePercentage ?? 0,
              status: "exit",
            });
            break;

          case "DUPLICATE_ATTENDANCE":
            setStatusModal({
              isOpen: true,
              type: "warning",
              title: "Already Marked",
              message: `${p.studentName}: Attendance has already been taken for this session.`,
            });
            setScanState("idle");
            break;

          case "SESSION_COMPLETED":
            setStatusModal({
              isOpen: true,
              type: "info",
              title: "Session Closed",
              message: `${p.studentName}: You have already signed out of this session.`,
            });
            setScanState("idle");
            break;

          case "NO_ACTIVE_SESSION":
            setStatusModal({
              isOpen: true,
              type: "error",
              title: "No Session",
              message: `${p.studentName}: There are no active sessions available right now.`,
            });
            setScanState("idle");
            break;

          case "NO_MATCHING_SESSION":
            setStatusModal({
              isOpen: true,
              type: "error",
              title: "Wrong Session",
              message: `${p.studentName}: No active session matches your Department (${p.department}) and Level.`,
            });
            setScanState("idle");
            break;

          case "VERIFY_RESPONSE":
            if (p.success === false) {
              setStatusModal({
                isOpen: true,
                type: "error",
                title: "Not Recognized",
                message: "Fingerprint did not match any student record.",
              });
              setScanState("error");
              setStatusMessage("Fingerprint not recognized");
            }
            break;

          default:
            break;
        }

        // Mark event as processed
        try {
          await updateDoc(doc(db, "deviceEvents", event.id), { processed: true });
        } catch {
          // Non-critical
        }
      }
    });

    return () => unsub();
  }, []);

  // ── Auto-reset after error/success ───────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (scanState === "error" || scanState === "success") {
      timer = setTimeout(() => {
        if (!cardData && !statusModal.isOpen) {
          setScanState("idle");
          setStatusMessage(gpsStatus === "ready" ? "Ready to authenticate" : "Syncing Satellite Data...");
        }
      }, 4000);
    }
    return () => clearTimeout(timer);
  }, [scanState, cardData, statusModal.isOpen, gpsStatus]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (cardData) {
      timer = setTimeout(() => {
        setCardData(null);
        setScanState("idle");
        setStatusMessage(gpsStatus === "ready" ? "Ready to authenticate" : "Syncing Satellite Data...");
      }, 8000);
    }
    return () => clearTimeout(timer);
  }, [cardData, gpsStatus]);

  // ── Send verification command ─────────────────────────────────────────────
  const handleStartVerification = async () => {
    if (gpsStatus === "offline") {
      setStatusModal({
        isOpen: true,
        type: "error",
        title: "Device Offline",
        message: "The biometric device is not connected. Please contact support.",
      });
      return;
    }
    if (gpsStatus !== "ready") {
      setStatusModal({
        isOpen: true,
        type: "warning",
        title: "GPS Offline",
        message: "Waiting for satellite synchronization. Please wait for GPS Lock.",
      });
      return;
    }

    setScanState("scanning");
    setStatusMessage("Place your finger on the scanner...");

    const result = await requestFingerprintVerification(DEVICE_ID);
    if (!result.success) {
      setScanState("error");
      setStatusMessage("Failed to send command. Please try again.");
    }
  };

  const handleCloseCard = () => {
    setCardData(null);
    setScanState("idle");
    setStatusMessage(gpsStatus === "ready" ? "Ready to authenticate" : "Syncing Satellite Data...");
  };

  return (
    <div className="min-h-screen bg-black-800 flex flex-col items-center justify-center p-6">
      {cardData && <AttendanceCard data={cardData} onClose={handleCloseCard} />}

      <StatusModal
        isOpen={statusModal.isOpen}
        onClose={() => setStatusModal((prev) => ({ ...prev, isOpen: false }))}
        type={statusModal.type}
        title={statusModal.title}
        message={statusModal.message}
      />

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12 relative">
          <div className="absolute -top-4 right-0 flex gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 shadow-md ${
                gpsStatus === "ready"
                  ? "bg-green-500/20 text-green-300 border border-green-400/30 shadow-lg shadow-green-500/20"
                  : gpsStatus === "searching"
                  ? "bg-blue-500/20 text-blue-300 border border-blue-400/30 animate-pulse"
                  : "bg-gray-500/20 text-gray-400 border border-gray-400/20"
              }`}
            >
              <Satellite
                className={`w-3.5 h-3.5 ${
                  gpsStatus === "searching" ? "animate-spin" : ""
                }`}
              />
              <span>
                {gpsStatus === "ready"
                  ? "GPS LOCKED"
                  : gpsStatus === "searching"
                  ? "ACQUIRING..."
                  : "OFFLINE"}
              </span>
            </div>
          </div>
          <h1 className="text-3xl font-semibold text-gray-300 mb-2">Biometric Login</h1>
          <p className="text-gray-500">Authenticate using your fingerprint</p>
        </div>

        {/* Main Card */}
        <div className="bg-gray-800 rounded-3xl shadow-lg p-8">
          {/* Icon */}
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div
                className={`absolute inset-0 rounded-full blur-2xl opacity-20 transition-all duration-500 ${
                  scanState === "scanning"
                    ? "bg-blue-500 scale-150"
                    : scanState === "success"
                    ? "bg-green-500 scale-150"
                    : scanState === "error"
                    ? "bg-red-500 scale-150"
                    : "bg-transparent"
                }`}
              />
              <div
                className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                  scanState === "scanning"
                    ? "bg-blue-50 border-2 border-blue-500"
                    : scanState === "success"
                    ? "bg-green-50 border-2 border-green-500"
                    : scanState === "error"
                    ? "bg-red-50 border-2 border-red-500"
                    : "bg-gray-50 border-2 border-gray-200"
                }`}
              >
                {scanState === "scanning" && <Loader className="w-12 h-12 text-blue-600 animate-spin" />}
                {scanState === "success" && <CheckCircle className="w-12 h-12 text-green-600" />}
                {scanState === "error" && <XCircle className="w-12 h-12 text-red-600" />}
                {scanState === "idle" && <Fingerprint className="w-12 h-12 text-gray-400" />}
              </div>
            </div>
          </div>

          {/* Status Message */}
          <div className="text-center mb-8">
            <p
              className={`text-lg font-semibold transition-all duration-300 ${
                scanState === "scanning"
                  ? "text-blue-600"
                  : scanState === "success"
                  ? "text-green-600"
                  : scanState === "error"
                  ? "text-red-600"
                  : gpsStatus === "searching"
                  ? "text-blue-400"
                  : "text-gray-300"
              }`}
            >
              {statusMessage}
            </p>
            {gpsStatus === "searching" && (
              <p className="text-xs text-gray-500 mt-2 animate-pulse">
                Waiting for satellite lock...
              </p>
            )}
          </div>

          {/* Button */}
          <button
            onClick={handleStartVerification}
            disabled={scanState === "scanning" || gpsStatus !== "ready"}
            className={`w-full py-4 rounded-xl font-medium text-base transition-all duration-200 ${
              scanState === "scanning" || gpsStatus !== "ready"
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-md hover:shadow-lg"
            }`}
          >
            {scanState === "scanning"
              ? "Scanning..."
              : gpsStatus !== "ready"
              ? gpsStatus === "offline"
                ? "Device Offline"
                : "Waiting for GPS..."
              : "Start Authentication"}
          </button>
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-400">Secured by Dern Technology</p>
        </div>
      </div>
    </div>
  );
}