import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useStudentPhoto } from '../utils/useStudentPhoto';
import { findPhotoDoc } from '../utils/studentPhoto';
import { useBackClose } from '../utils/useBackClose';

// Small round photo. Renders nothing when the student has no real photo.
export function StudentPhotoThumb({ student, onOpen, size = 32 }) {
  const src = useStudentPhoto(student);
  const hasPhoto = Boolean(findPhotoDoc(student)) && Boolean(src);
  if (!hasPhoto) return null;
  const name = student?.name || 'Student';
  return (
    <button
      type="button"
      className="st-photo-btn"
      aria-label={`View photo of ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(src, name);
      }}
      style={{ width: size, height: size }}
    >
      <img src={src} alt="" className="st-photo" />
    </button>
  );
}

// Large photo. Sits above the student profile (z-index 1200).
export function StudentPhotoLightbox({ src, name, onClose }) {
  useBackClose(Boolean(src), onClose);
  useEffect(() => {
    if (!src) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, onClose]);
  if (!src) return null;
  return createPortal(
    <div
      className="modal-overlay student-photo-lightbox"
      style={{ zIndex: 1200 }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="student-photo-lightbox-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${name || 'Student'} photo`}
      >
        <button type="button" className="student-photo-lightbox-close" aria-label="Close photo" onClick={onClose}>
          <X size={22} />
        </button>
        <img src={src} alt={`${name || 'Student'} photo`} />
      </div>
    </div>,
    document.body
  );
}
