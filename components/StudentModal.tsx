// StudentModal.tsx
// Replaces ws://localhost:5000 with:
//  - /api/device/command  (CAPTURE_FINGERPRINT)
//  - Firestore onSnapshot on deviceEvents (ENROLL_RESPONSE)

import React, { useState, useEffect, useRef, FormEvent } from "react";
import { db } from "../services/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
} from "firebase/firestore";
import { Student } from "../types";
import { requestFingerprintEnrollment } from "../services/deviceApi";

const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";

interface StudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (studentData: Omit<Student, "id">) => void;
  studentData: Student | null;
}

const departments = [
  "Computer Science",
  "Software Engineering",
  "Information Technology",
  "Cyber Security",
  "Electrical Electronics",
];
const levels = ["100", "200", "300", "400", "500"];

type FingerprintStatus = "idle" | "capturing" | "success" | "error";

export default function StudentModal({ isOpen, onClose, onSubmit, studentData }: StudentModalProps) {
  const [name, setName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [department, setDepartment] = useState(departments[0]);
  const [level, setLevel] = useState(levels[0]);
  const [fingerprintTemplate, setFingerprintTemplate] = useState("");
  const [fingerprintStatus, setFingerprintStatus] = useState<FingerprintStatus>("idle");
  const [fingerprintMessage, setFingerprintMessage] = useState("Not Captured");
  const [error, setError] = useState("");
  const processedEventIds = useRef<Set<string>>(new Set());
  const unsubRef = useRef<(() => void) | null>(null);

  // Populate form fields
  useEffect(() => {
    if (studentData) {
      setName(studentData.name);
      setStudentId(studentData.studentId || "");
      setDepartment(studentData.department);
      setLevel(studentData.level);
      if (studentData.fingerprintTemplate) {
        setFingerprintTemplate(studentData.fingerprintTemplate);
        setFingerprintStatus("success");
        setFingerprintMessage("Template captured");
      } else {
        setFingerprintTemplate("");
        setFingerprintStatus("idle");
        setFingerprintMessage("Not Captured");
      }
    } else {
      setName("");
      setStudentId("");
      setDepartment(departments[0]);
      setLevel(levels[0]);
      setFingerprintTemplate("");
      setFingerprintStatus("idle");
      setFingerprintMessage("Not Captured");
    }
    setError("");
    processedEventIds.current.clear();
  }, [studentData, isOpen]);

  // Subscribe to deviceEvents while modal is open
  useEffect(() => {
    if (!isOpen) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }

    const cutoff = new Date(Date.now() - 60_000).toISOString();
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

        if (event.eventType === "ENROLL_RESPONSE") {
          processedEventIds.current.add(event.id);
          const p = event.payload ?? {};
          if (p.success) {
            setFingerprintTemplate(String(p.id ?? p.fingerprintId ?? ""));
            setFingerprintStatus("success");
            setFingerprintMessage(`Template captured successfully! (ID: ${p.id ?? p.fingerprintId})`);
          } else {
            setFingerprintStatus("error");
            setFingerprintMessage(p.error ?? "Capture failed.");
          }
          try {
            await updateDoc(doc(db, "deviceEvents", event.id), { processed: true });
          } catch { /* non-critical */ }
        }
      }
    });

    unsubRef.current = unsub;
    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCaptureFingerprint = async () => {
    setFingerprintStatus("capturing");
    setFingerprintMessage("Sending capture command...");
    const result = await requestFingerprintEnrollment(DEVICE_ID);
    if (!result.success) {
      setFingerprintStatus("error");
      setFingerprintMessage("Could not reach device. Please try again.");
    } else {
      setFingerprintMessage("Place finger on scanner...");
    }
  };

  const getStatusIndicatorClasses = () => {
    switch (fingerprintStatus) {
      case "success": return "bg-green-100 text-green-800";
      case "capturing": return "bg-blue-100 text-blue-800 animate-pulse";
      case "error": return "bg-red-100 text-red-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name || !studentId || !department || !level) {
      setError("All fields except fingerprint are required.");
      return;
    }
    if (!fingerprintTemplate || fingerprintStatus !== "success") {
      setError("A fingerprint must be successfully captured.");
      return;
    }
    onSubmit({ name, studentId, department, level, fingerprintTemplate });
  };

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 z-50 flex justify-center items-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-bold mb-6 text-gray-900">
          {studentData ? "Edit Student" : "Add Student"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
              <span className="block sm:inline">{error}</span>
            </div>
          )}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
            <input type="text" id="name" value={name} onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="studentId" className="block text-sm font-medium text-gray-700">Student ID</label>
            <input type="text" id="studentId" value={studentId} onChange={(e) => setStudentId(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
          </div>
          <div>
            <label htmlFor="department" className="block text-sm font-medium text-gray-700">Department</label>
            <select id="department" value={department} onChange={(e) => setDepartment(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              {departments.map((dep) => <option key={dep} value={dep}>{dep}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="level" className="block text-sm font-medium text-gray-700">Level</label>
            <select id="level" value={level} onChange={(e) => setLevel(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
              {levels.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
            </select>
          </div>

          {/* Fingerprint Section */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Fingerprint</label>
            <div className="mt-1 flex items-center space-x-4 p-2 border border-gray-300 rounded-md">
              <button
                type="button"
                onClick={handleCaptureFingerprint}
                disabled={fingerprintStatus === "capturing"}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-wait"
              >
                {fingerprintStatus === "capturing" ? "Capturing..." : "Capture"}
              </button>
              <div className="flex-1 text-center">
                <span className={`px-3 py-1 text-sm font-medium rounded-full transition-colors duration-300 ${getStatusIndicatorClasses()}`}>
                  {fingerprintMessage}
                </span>
              </div>
            </div>
            {fingerprintStatus === "capturing" && (
              <p className="text-xs text-blue-600 mt-1 animate-pulse">
                ⏳ Command queued — place finger on the scanner when it beeps...
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-4 pt-4">
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
              Cancel
            </button>
            <button type="submit" disabled={fingerprintStatus !== "success"}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
