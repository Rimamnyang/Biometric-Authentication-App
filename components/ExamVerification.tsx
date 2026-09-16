// ExamVerification.tsx
// Replaces ws://localhost:5000 with:
//  - /api/device/command  (to trigger VERIFY_FINGERPRINT)
//  - Firestore onSnapshot on deviceEvents (to receive VERIFY_RESPONSE)
// The Firestore student lookup and attendance check remain in the browser (read-only).

import React, { useState, useEffect, useRef } from "react";
import { db } from "../services/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { Course, Student, AccessCardData } from "../types";
import ExamCard from "./ExamCard";
import { CheckCircle, XCircle, Fingerprint, Loader } from "lucide-react";
import { requestFingerprintVerification } from "../services/deviceApi";

const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";

type ScanState = "idle" | "scanning" | "success" | "error";

export default function ExamVerification() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [statusMessage, setStatusMessage] = useState("Click button to begin verification");
  const [verifiedData, setVerifiedData] = useState<AccessCardData | null>(null);
  const processedEventIds = useRef<Set<string>>(new Set());

  // ── Listen for deviceEvents ───────────────────────────────────────────────
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

        if (event.eventType === "VERIFY_RESPONSE") {
          if (p.success) {
            await handleSuccessfulVerification(String(p.id ?? p.fingerprintId ?? ""));
          } else {
            setScanState("error");
            setStatusMessage("No match found");
          }
          try {
            await updateDoc(doc(db, "deviceEvents", event.id), { processed: true });
          } catch { /* non-critical */ }
        }
      }
    });

    return () => unsub();
  }, []);

  // ── Auto-reset on error ───────────────────────────────────────────────────
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (scanState === "error") {
      timer = setTimeout(() => {
        setScanState("idle");
        setStatusMessage("Click button to begin verification");
        setVerifiedData(null);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [scanState]);

  // ── Look up student and check attendance eligibility ──────────────────────
  const handleSuccessfulVerification = async (fingerprintId: string) => {
    if (!fingerprintId) return;
    try {
      // 1. Find student by fingerprint
      const studentSnap = await getDocs(
        query(collection(db, "students"), where("fingerprintTemplate", "==", fingerprintId))
      );
      if (studentSnap.empty) {
        setScanState("error");
        setStatusMessage("Fingerprint not recognized. Please contact the exam officer.");
        return;
      }
      const studentDoc = studentSnap.docs[0];
      const studentData = { id: studentDoc.id, ...studentDoc.data() } as Student;

      // 2. Find active session for student's dept/level
      const activeSessionsSnap = await getDocs(
        query(collection(db, "sessions"), where("active", "==", true))
      );
      if (activeSessionsSnap.empty) {
        setScanState("error");
        setStatusMessage("No active exam session found.");
        return;
      }

      const coursesSnap = await getDocs(collection(db, "courses"));
      const coursesMap = new Map<string, Omit<Course, "id">>(
        coursesSnap.docs.map((d) => [d.id, d.data() as Omit<Course, "id">])
      );

      let matchedSessionDoc = null;
      let matchedCourseData: (Omit<Course, "id"> & { id: string }) | null = null;
      for (const sessionDoc of activeSessionsSnap.docs) {
        const sd = sessionDoc.data();
        const cd = coursesMap.get(sd.courseId);
        if (cd && cd.department === studentData.department && cd.level === studentData.level) {
          matchedSessionDoc = sessionDoc;
          matchedCourseData = { id: sd.courseId, ...cd };
          break;
        }
      }

      if (!matchedSessionDoc || !matchedCourseData) {
        setScanState("error");
        setStatusMessage("No active exam for your department/level.");
        return;
      }

      // 3. Calculate attendance percentage
      const allSessionsSnap = await getDocs(
        query(collection(db, "sessions"), where("courseId", "==", matchedCourseData.id))
      );
      const totalClasses = allSessionsSnap.docs.length;
      const attendanceSnap = await getDocs(
        query(
          collection(db, "attendance"),
          where("studentId", "==", studentData.id),
          where("courseId", "==", matchedCourseData.id)
        )
      );
      const attendedClasses = attendanceSnap.docs.length;
      const attendancePercentage =
        totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 0;

      // 4. Enforce 70% threshold
      if (attendancePercentage < 70) {
        setScanState("error");
        setStatusMessage(
          `Access Denied: Minimum 70% attendance required. Yours is ${attendancePercentage}%.`
        );
        return;
      }

      // 5. Grant access
      setScanState("success");
      setStatusMessage("Verified");
      setVerifiedData({
        name: studentData.name,
        studentId: studentData.studentId,
        department: studentData.department,
        courseName: `${matchedCourseData.name} (${matchedCourseData.code})`,
        attendancePercentage,
      });
    } catch (error) {
      console.error("Verification Error:", error);
      setScanState("error");
      setStatusMessage("An unexpected server error occurred.");
    }
  };

  // ── Send verify command ───────────────────────────────────────────────────
  const handleStartVerification = async () => {
    setScanState("scanning");
    setStatusMessage("Place your finger on the scanner...");
    const result = await requestFingerprintVerification(DEVICE_ID);
    if (!result.success) {
      setScanState("error");
      setStatusMessage("Device not connected. Please try again.");
    }
  };

  const handleCloseCard = () => {
    setVerifiedData(null);
    setScanState("idle");
    setStatusMessage("Click button to begin verification");
  };

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-6">
      {verifiedData && <ExamCard data={verifiedData} onClose={handleCloseCard} />}

      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12 relative">
          <h1 className="text-3xl font-semibold text-gray-300 mb-2">Exam Verification</h1>
          <p className="text-gray-500">Verify eligibility for exam entry</p>
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

          {/* Status */}
          <div className="text-center mb-8">
            <p
              className={`text-lg font-semibold transition-all duration-300 ${
                scanState === "scanning"
                  ? "text-blue-600"
                  : scanState === "success"
                  ? "text-green-600"
                  : scanState === "error"
                  ? "text-red-600"
                  : "text-gray-300"
              }`}
            >
              {statusMessage}
            </p>
          </div>

          {/* Button */}
          <button
            onClick={handleStartVerification}
            disabled={scanState === "scanning"}
            className={`w-full py-4 rounded-xl font-medium text-base transition-all duration-200 ${
              scanState === "scanning"
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[0.98] shadow-md hover:shadow-lg"
            }`}
          >
            {scanState === "scanning" ? "Verifying..." : "Start Verification"}
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
