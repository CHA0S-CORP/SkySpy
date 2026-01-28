import React, { useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, Info, AlertCircle, Trash2 } from 'lucide-react';

/**
 * Reusable confirmation modal to replace native confirm() dialogs.
 * Provides accessible, styled confirmation dialogs with customizable actions.
 */

const MODAL_VARIANTS = {
  danger: {
    Icon: Trash2,
    iconColor: 'var(--accent-red)',
    confirmClass: 'btn-danger',
  },
  warning: {
    Icon: AlertTriangle,
    iconColor: 'var(--accent-yellow)',
    confirmClass: 'btn-warning',
  },
  info: {
    Icon: Info,
    iconColor: 'var(--accent-cyan)',
    confirmClass: 'btn-primary',
  },
  default: {
    Icon: AlertCircle,
    iconColor: 'var(--text-secondary)',
    confirmClass: 'btn-primary',
  },
};

export function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  loading = false,
  children,
}) {
  const modalRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const previousActiveElement = useRef(null);

  const variantConfig = MODAL_VARIANTS[variant] || MODAL_VARIANTS.default;
  const { Icon, iconColor, confirmClass } = variantConfig;

  // Store previous focus and focus confirm button on open
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      // Focus confirm button after a brief delay to ensure modal is rendered
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Return focus when modal closes
  const handleClose = useCallback(() => {
    previousActiveElement.current?.focus();
    onCancel?.();
  }, [onCancel]);

  // Handle confirm
  const handleConfirm = useCallback(() => {
    onConfirm?.();
  }, [onConfirm]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay confirm-modal-overlay"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="modal confirm-modal"
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
      >
        <div className="confirm-modal-header">
          <div className="confirm-modal-icon" style={{ color: iconColor }}>
            <Icon size={24} aria-hidden="true" />
          </div>
          <h3 id="confirm-modal-title">{title}</h3>
          <button
            className="confirm-modal-close"
            onClick={handleClose}
            aria-label="Close dialog"
            type="button"
            disabled={loading}
          >
            <X size={20} />
          </button>
        </div>

        <div className="confirm-modal-content">
          <p id="confirm-modal-description">{message}</p>
          {children}
        </div>

        <div className="confirm-modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={confirmClass}
            onClick={handleConfirm}
            disabled={loading}
            ref={confirmButtonRef}
            aria-busy={loading}
          >
            {loading ? 'Please wait...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
