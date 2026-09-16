// StudentManagement.tsx
// Replaces three WebSocket usages (single delete, bulk delete, clear-all)
// with calls to /api/device/command and Firestore onSnapshot for results.

import React, { useState, useEffect, useRef } from "react";
import {
  collection,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
} from "firebase/firestore";
import { db } from "../services/firebase";
import { Student } from "../types";
import StudentModal from "./StudentModal";
import Spinner from "./Spinner";
import Toast from "./Toast";
import ConfirmModal from "./ConfirmModal";
import { deleteFingerprint, clearAllFingerprints } from "../services/deviceApi";

export default function StudentManagement() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [deletingStudentId, setDeletingStudentId] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deleteAllProgress, setDeleteAllProgress] = useState({ current: 0, total: 0 });
  const [isClearingFingerprints, setIsClearingFingerprints] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    variant: "danger" | "warning" | "info";
    onConfirm: () => void;
  }>({ isOpen: false, title: "", message: "", variant: "warning", onConfirm: () => {} });

  const processedEventIds = useRef<Set<string>>(new Set());

  // ── Load students ────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const unsubscribe = onSnapshot(
      collection(db, "students"),
      (snapshot) => {
        setStudents(snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Student)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ── CRUD helpers ─────────────────────────────────────────────────────────
  const handleOpenModal = (student: Student | null = null) => {
    setEditingStudent(student);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingStudent(null);
  };

  const handleFormSubmit = async (studentData: Omit<Student, "id">) => {
    try {
      if (editingStudent) {
        await updateDoc(doc(db, "students", editingStudent.id), studentData);
      } else {
        await addDoc(collection(db, "students"), studentData);
      }
      handleCloseModal();
    } catch (error) {
      console.error("Error saving student:", error);
    }
  };

  // ── Delete single student ────────────────────────────────────────────────
  const handleDeleteStudent = async (id: string) => {
    const studentToDelete = students.find((s) => s.id === id);
    if (!studentToDelete) return;

    // No fingerprint — just delete from DB
    if (!studentToDelete.fingerprintTemplate) {
      setConfirmModal({
        isOpen: true,
        title: "Delete Student",
        message: "This student has no fingerprint registered. Delete from database?",
        variant: "danger",
        onConfirm: async () => {
          setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          try {
            setDeletingStudentId(id);
            await deleteDoc(doc(db, "students", id));
            setToast({ type: "success", message: "Student deleted successfully!" });
          } catch {
            setToast({ type: "error", message: "Error deleting student from database." });
          } finally {
            setDeletingStudentId(null);
          }
        },
      });
      return;
    }

    // Has fingerprint — delete from hardware then DB
    setConfirmModal({
      isOpen: true,
      title: "Delete Student",
      message:
        "Are you sure? This will also remove their fingerprint from the scanner module.",
      variant: "danger",
      onConfirm: async () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        setDeletingStudentId(id);

        const result = await deleteFingerprint(studentToDelete.fingerprintTemplate);
        if (!result.success) {
          setToast({ type: "error", message: "Could not reach device. Please try again." });
          setDeletingStudentId(null);
          return;
        }

        // Listen for DELETE_RESPONSE then clean up DB
        const cutoff = new Date(Date.now() - 5_000).toISOString();
        const q = query(
          collection(db, "deviceEvents"),
          where("eventType", "==", "DELETE_RESPONSE"),
          where("processed", "==", false)
        );

        let timeout: ReturnType<typeof setTimeout>;
        const unsub = onSnapshot(q, async (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== "added" && change.type !== "modified") continue;
            const ev = { id: change.doc.id, ...change.doc.data() } as any;
            if (processedEventIds.current.has(ev.id)) continue;
            if (ev.createdAt < cutoff) continue;
            processedEventIds.current.add(ev.id);

            clearTimeout(timeout);
            unsub();

            const p = ev.payload ?? {};
            if (p.success) {
              try {
                await deleteDoc(doc(db, "students", id));
                setToast({ type: "success", message: "Student and fingerprint deleted!" });
              } catch {
                setToast({ type: "error", message: "Fingerprint deleted but DB cleanup failed." });
              }
            } else {
              setToast({ type: "error", message: `Delete failed: ${p.error ?? "Unknown error"}` });
            }

            try { await updateDoc(doc(db, "deviceEvents", ev.id), { processed: true }); } catch {}
            setDeletingStudentId(null);
          }
        });

        // Timeout after 15s
        timeout = setTimeout(() => {
          unsub();
          setToast({ type: "error", message: "Timeout waiting for device response." });
          setDeletingStudentId(null);
        }, 15_000);
      },
    });
  };

  // ── Bulk delete ──────────────────────────────────────────────────────────
  const handleDeleteAll = async () => {
    if (students.length === 0) {
      setToast({ type: "info", message: "No students to delete." });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: "Delete All Students",
      message:
        `Are you sure you want to delete ALL ${students.length} students?\n\n` +
        "1. Delete all fingerprint templates from the scanner\n" +
        "2. Remove all students from the database\n\n" +
        "This action CANNOT be undone!",
      variant: "danger",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        performBulkDelete();
      },
    });
  };

  const performBulkDelete = async () => {
    setIsDeletingAll(true);
    const studentsToDelete = [...students];
    setDeleteAllProgress({ current: 0, total: studentsToDelete.length });
    let success = 0;
    let failed = 0;

    for (let i = 0; i < studentsToDelete.length; i++) {
      const student = studentsToDelete[i];
      setDeleteAllProgress({ current: i + 1, total: studentsToDelete.length });

      if (!student.fingerprintTemplate) {
        try {
          await deleteDoc(doc(db, "students", student.id));
          success++;
        } catch {
          failed++;
        }
        continue;
      }

      // Send delete command and wait for event (with timeout)
      const cmdResult = await deleteFingerprint(student.fingerprintTemplate);
      if (!cmdResult.success) {
        failed++;
        continue;
      }

      const deleteOk = await waitForDeleteResponse(5);
      if (deleteOk) {
        try {
          await deleteDoc(doc(db, "students", student.id));
          success++;
        } catch {
          failed++;
        }
      } else {
        failed++;
      }
    }

    setIsDeletingAll(false);
    setToast({
      type: failed === 0 ? "success" : "info",
      message: `Done! ✅ ${success} deleted, ❌ ${failed} failed`,
    });
  };

  /** Waits up to `timeoutSec` for a DELETE_RESPONSE deviceEvent */
  const waitForDeleteResponse = (timeoutSec: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const cutoff = new Date(Date.now() - 2_000).toISOString();
      const q = query(
        collection(db, "deviceEvents"),
        where("eventType", "==", "DELETE_RESPONSE"),
        where("processed", "==", false)
      );
      const timeout = setTimeout(() => { unsub(); resolve(false); }, timeoutSec * 1000);
      const unsub = onSnapshot(q, async (snap) => {
        for (const change of snap.docChanges()) {
          if (change.type !== "added" && change.type !== "modified") continue;
          const ev = { id: change.doc.id, ...change.doc.data() } as any;
          if (processedEventIds.current.has(ev.id)) continue;
          if (ev.createdAt < cutoff) continue;
          processedEventIds.current.add(ev.id);
          clearTimeout(timeout);
          unsub();
          try { await updateDoc(doc(db, "deviceEvents", ev.id), { processed: true }); } catch {}
          resolve((ev.payload ?? {}).success === true);
          return;
        }
      });
    });
  };

  // ── Clear all fingerprints ────────────────────────────────────────────────
  const handleClearAllFingerprints = () => {
    setConfirmModal({
      isOpen: true,
      title: "Clear All Fingerprints",
      message:
        "Are you sure you want to clear ALL fingerprints from the sensor module?\n\n" +
        "1. Erase all fingerprint templates from the hardware\n" +
        "2. Students will need to re-enroll their fingerprints\n\n" +
        "This action CANNOT be undone!",
      variant: "danger",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        performClearAllFingerprints();
      },
    });
  };

  const performClearAllFingerprints = async () => {
    setIsClearingFingerprints(true);
    const result = await clearAllFingerprints();

    if (!result.success) {
      setToast({ type: "error", message: "Could not reach device. Please try again." });
      setIsClearingFingerprints(false);
      return;
    }

    // Wait for CLEAR_ALL_RESPONSE event
    const cutoff = new Date(Date.now() - 3_000).toISOString();
    const q = query(
      collection(db, "deviceEvents"),
      where("eventType", "==", "CLEAR_ALL_RESPONSE"),
      where("processed", "==", false)
    );

    let timeout: ReturnType<typeof setTimeout>;
    const unsub = onSnapshot(q, async (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type !== "added" && change.type !== "modified") continue;
        const ev = { id: change.doc.id, ...change.doc.data() } as any;
        if (processedEventIds.current.has(ev.id)) continue;
        if (ev.createdAt < cutoff) continue;
        processedEventIds.current.add(ev.id);

        clearTimeout(timeout);
        unsub();

        const p = ev.payload ?? {};
        setToast(
          p.success
            ? { type: "success", message: "All fingerprints cleared from sensor module!" }
            : { type: "error", message: `Failed: ${p.error ?? "Unknown error"}` }
        );
        try { await updateDoc(doc(db, "deviceEvents", ev.id), { processed: true }); } catch {}
        setIsClearingFingerprints(false);
      }
    });

    timeout = setTimeout(() => {
      unsub();
      setToast({ type: "error", message: "Timeout waiting for device response." });
      setIsClearingFingerprints(false);
    }, 15_000);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="bg-white shadow-xl rounded-lg p-6 md:p-8">
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Manage Students</h1>
        <div className="flex gap-3">
          <button
            onClick={handleClearAllFingerprints}
            disabled={isClearingFingerprints}
            className="px-5 py-2.5 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2"
          >
            {isClearingFingerprints ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Clearing...
              </>
            ) : "Clear All Fingerprints"}
          </button>
          <button
            onClick={handleDeleteAll}
            disabled={isDeletingAll || students.length === 0}
            className="px-5 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200 flex items-center gap-2"
          >
            {isDeletingAll ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Deleting {deleteAllProgress.current}/{deleteAllProgress.total}
              </>
            ) : "Delete All Students"}
          </button>
          <button
            onClick={() => handleOpenModal()}
            className="px-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition-colors duration-200"
          >
            Add Student
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Name", "Student ID", "Department", "Level", ""].map((h) => (
                <th key={h} scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {students.length > 0 ? (
              students.map((student) => (
                <tr key={student.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{student.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{student.studentId}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{student.department}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{student.level}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                    <button onClick={() => handleOpenModal(student)} className="text-indigo-600 hover:text-indigo-900">Edit</button>
                    <button
                      onClick={() => handleDeleteStudent(student.id)}
                      disabled={deletingStudentId === student.id}
                      className="text-red-600 hover:text-red-900 disabled:text-gray-400 disabled:cursor-wait"
                    >
                      {deletingStudentId === student.id ? "Deleting..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-6 py-4 text-center text-sm text-gray-500">No students found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <StudentModal
          isOpen={isModalOpen}
          onClose={handleCloseModal}
          onSubmit={handleFormSubmit}
          studentData={editingStudent}
        />
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        confirmText="Delete"
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
