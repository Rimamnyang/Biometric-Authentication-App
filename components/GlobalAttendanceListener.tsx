// GlobalAttendanceListener.tsx
// Replaces the old WebSocket bridge listener.
// Now listens to Firestore `deviceEvents` collection for real-time updates.
// Attendance DB writes are performed server-side (api/device/event.ts).
// This component is only responsible for UI feedback: toasts and attendance cards.

import React, { useEffect, useRef, useState } from "react";
import { db } from "../services/firebase";
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
  updateDoc,
  doc,
  Timestamp,
} from "firebase/firestore";

const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";

// Lightweight toast shown globally when someone scans at the kiosk
interface AttendanceToast {
  id: string;
  type: "entry" | "exit" | "error" | "warning" | "info";
  title: string;
  message: string;
}

export default function GlobalAttendanceListener() {
  const [toasts, setToasts] = useState<AttendanceToast[]>([]);
  // Track which events we've already handled to avoid double-processing on remount
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Listen for recent, unprocessed deviceEvents
    const cutoff = new Date(Date.now() - 30_000).toISOString(); // last 30 seconds

    const q = query(
      collection(db, "deviceEvents"),
      where("deviceId", "==", DEVICE_ID),
      where("processed", "==", false),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type !== "added" && change.type !== "modified") continue;

        const eventDoc = change.doc;
        const event = { id: eventDoc.id, ...eventDoc.data() } as any;

        // Skip already-processed or stale events
        if (processedIds.current.has(event.id)) continue;
        if (event.createdAt < cutoff && change.type === "added") continue;

        processedIds.current.add(event.id);

        const p = event.payload ?? {};

        switch (event.eventType) {
          case "ATTENDANCE_RECORDED":
            addToast({
              id: event.id,
              type: "entry",
              title: "✅ Signed In",
              message: `${p.studentName} — ${p.courseName}`,
            });
            break;

          case "SIGNED_OUT":
            addToast({
              id: event.id,
              type: "exit",
              title: "👋 Signed Out",
              message: `${p.studentName} — ${p.courseName}`,
            });
            break;

          case "NO_ACTIVE_SESSION":
            addToast({
              id: event.id,
              type: "warning",
              title: "No Active Session",
              message: p.message ?? "No sessions currently open",
            });
            break;

          case "NO_MATCHING_SESSION":
            addToast({
              id: event.id,
              type: "warning",
              title: "Wrong Session",
              message: `${p.studentName}: No session for ${p.department}`,
            });
            break;

          case "SESSION_COMPLETED":
            addToast({
              id: event.id,
              type: "info",
              title: "Session Closed",
              message: p.message ?? "Already signed out",
            });
            break;

          case "DUPLICATE_ATTENDANCE":
            addToast({
              id: event.id,
              type: "info",
              title: "Already Marked",
              message: p.message ?? "Attendance already recorded",
            });
            break;

          default:
            break;
        }

        // Mark event as processed so other listeners don't re-show it
        try {
          await updateDoc(doc(db, "deviceEvents", event.id), { processed: true });
        } catch {
          // Non-critical — ignore
        }
      }
    });

    return () => unsubscribe();
  }, []);

  function addToast(toast: AttendanceToast) {
    setToasts((prev) => [toast, ...prev].slice(0, 5));
    // Auto-dismiss after 6 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    }, 6000);
  }

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-lg shadow-lg text-white text-sm max-w-xs pointer-events-auto transition-all duration-300 ${
            toast.type === "entry"
              ? "bg-green-600"
              : toast.type === "exit"
              ? "bg-blue-600"
              : toast.type === "warning"
              ? "bg-yellow-600"
              : toast.type === "error"
              ? "bg-red-600"
              : "bg-gray-700"
          }`}
        >
          <div className="font-semibold">{toast.title}</div>
          <div className="opacity-90">{toast.message}</div>
        </div>
      ))}
    </div>
  );
}
