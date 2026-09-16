// ServerStatus.tsx
// Replaces the old WebSocket connection to ws://localhost:5000.
// Now reads device status from the Firestore `devices` document (realtime)
// and falls back to polling /api/device/status every 15s.

import React, { useState, useEffect } from "react";
import { db } from "../services/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { getDeviceStatus } from "../services/deviceApi";

const DEVICE_ID = import.meta.env.VITE_DEVICE_ID ?? "attendance-device-01";
const ONLINE_THRESHOLD_MS = 60_000;

interface Esp32Status {
  wifi?: boolean;
  fingerprint?: boolean;
  gps?: boolean;
  gpsFixed?: boolean;
  satellites?: number;
  ip?: string;
}

interface DisplayStatus {
  online: boolean;
  esp32Connected: boolean;
  esp32Status?: Esp32Status;
  lastSeen?: string | null;
}

function isOnline(lastSeen?: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD_MS;
}

export default function ServerStatus() {
  const [status, setStatus] = useState<DisplayStatus>({
    online: false,
    esp32Connected: false,
  });

  // Realtime Firestore listener on the device document
  useEffect(() => {
    const deviceRef = doc(db, "devices", DEVICE_ID);
    const unsubscribe = onSnapshot(deviceRef, (snap) => {
      if (!snap.exists()) {
        setStatus({ online: false, esp32Connected: false });
        return;
      }
      const data = snap.data();
      const online = isOnline(data?.lastSeen);
      setStatus({
        online,
        esp32Connected: online,
        esp32Status: data?.esp32Status ?? undefined,
        lastSeen: data?.lastSeen ?? null,
      });
    });
    return () => unsubscribe();
  }, []);

  // Fallback: poll the API every 15 seconds (in case Firestore rules block client reads)
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const s = await getDeviceStatus(DEVICE_ID);
      if (cancelled || !s) return;
      setStatus((prev) => ({
        ...prev,
        online: s.online,
        esp32Connected: s.online,
        esp32Status: (s.esp32Status as Esp32Status) ?? prev.esp32Status,
        lastSeen: s.lastSeen ?? prev.lastSeen,
      }));
    };
    const id = setInterval(poll, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="bg-white shadow rounded-lg p-4 mb-6">
      <h2 className="text-lg font-semibold text-gray-700 mb-3">System Status</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* API / Connection Status */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-500 uppercase">Connection</span>
          <div className="flex items-center mt-1">
            <span
              className={`w-3 h-3 rounded-full mr-2 ${
                status.online ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className={`font-medium ${status.online ? "text-green-700" : "text-red-700"}`}>
              {status.online ? "Online" : "Offline"}
            </span>
          </div>
        </div>

        {/* ESP32 Device */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-500 uppercase">ESP32 Device</span>
          <div className="flex items-center mt-1">
            <span
              className={`w-3 h-3 rounded-full mr-2 ${
                status.esp32Connected ? "bg-green-500" : "bg-gray-400"
              }`}
            />
            <span className="font-medium text-gray-800">
              {status.esp32Connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        {/* Module Status */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-500 uppercase">Modules</span>
          <div className="flex flex-col mt-1 space-y-1">
            <div className="flex items-center text-sm">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${
                  status.esp32Status?.fingerprint ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-gray-600">Fingerprint</span>
            </div>
            <div className="flex items-center text-sm">
              <span
                className={`w-2 h-2 rounded-full mr-2 ${
                  status.esp32Status?.gps ? "bg-green-500" : "bg-red-400"
                }`}
              />
              <span className="text-gray-600">
                GPS {status.esp32Status?.gpsFixed ? "(Fixed)" : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Satellites */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-500 uppercase">Satellites</span>
          <span className="text-lg font-bold text-gray-800">
            {status.esp32Status?.satellites ?? 0}
          </span>
          {status.lastSeen && (
            <span className="text-xs text-gray-400 mt-1">
              Last seen: {new Date(status.lastSeen).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
