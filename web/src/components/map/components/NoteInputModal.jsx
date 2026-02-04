import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { StickyNote, Trash2, Save, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/dialog';

/**
 * Modal for adding/editing notes on aircraft.
 *
 * Features:
 * - Textarea for note input (max 500 chars)
 * - Save/Cancel/Delete actions
 * - Character count
 * - Auto-focus on open
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the modal is open
 * @param {Function} props.onClose - Callback when modal closes
 * @param {Function} props.onSave - Callback with note text when saving
 * @param {Function} props.onDelete - Callback when deleting (only shown if existingNote)
 * @param {string} props.aircraftId - Aircraft identifier (hex/callsign) for display
 * @param {string} props.existingNote - Existing note to edit (if any)
 */
export function NoteInputModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  aircraftId,
  existingNote = '',
}) {
  const [noteText, setNoteText] = useState(existingNote || '');
  const textareaRef = useRef(null);
  const MAX_LENGTH = 500;

  // Reset note text when modal opens or existingNote changes
  useEffect(() => {
    if (isOpen) {
      setNoteText(existingNote || '');
    }
  }, [isOpen, existingNote]);

  // Focus textarea when modal opens
  useEffect(() => {
    if (isOpen && textareaRef.current) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        // Move cursor to end
        textareaRef.current?.setSelectionRange(
          textareaRef.current.value.length,
          textareaRef.current.value.length
        );
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSave = () => {
    onSave(noteText.trim());
    onClose();
  };

  const handleDelete = () => {
    onDelete?.();
    onClose();
  };

  const handleKeyDown = (e) => {
    // Ctrl/Cmd + Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
    // Escape to close
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const hasChanges = noteText.trim() !== (existingNote || '').trim();
  const isEditing = Boolean(existingNote);
  const charCount = noteText.length;
  const isOverLimit = charCount > MAX_LENGTH;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm" className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <StickyNote size={20} className="text-accent-yellow" />
            <DialogTitle>
              {isEditing ? 'Edit Note' : 'Add Note'}
            </DialogTitle>
          </div>
          <DialogDescription>
            {aircraftId ? (
              <>
                Aircraft: <span className="font-mono text-text-primary">{aircraftId}</span>
              </>
            ) : (
              'Add a personal note for this aircraft'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          <textarea
            ref={textareaRef}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g., VIP flight, Possible go-around, Training flight..."
            maxLength={MAX_LENGTH + 50} // Allow slight overflow for UX
            className={`
              w-full h-32 px-3 py-2
              bg-bg-dark border rounded-md
              text-text-primary placeholder-text-muted
              resize-none
              focus:outline-none focus:ring-2 focus:ring-accent-cyan/50
              ${isOverLimit ? 'border-accent-red' : 'border-border'}
            `}
            aria-label="Aircraft note"
            aria-describedby="note-char-count"
          />
          <div
            id="note-char-count"
            className={`
              mt-1 text-xs text-right
              ${isOverLimit ? 'text-accent-red' : 'text-text-muted'}
            `}
          >
            {charCount}/{MAX_LENGTH}
            {charCount > 0 && (
              <span className="ml-2 text-text-muted">
                (Ctrl+Enter to save)
              </span>
            )}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between gap-2">
          {/* Left side - Delete button (only if editing) */}
          <div>
            {isEditing && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className="
                  flex items-center gap-1.5 px-3 py-2
                  text-sm text-accent-red hover:text-white
                  bg-transparent hover:bg-accent-red/20
                  border border-accent-red/50 hover:border-accent-red
                  rounded-md transition-colors duration-200
                "
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>

          {/* Right side - Cancel and Save */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="
                flex items-center gap-1.5 px-3 py-2
                text-sm text-text-secondary hover:text-text-primary
                bg-transparent hover:bg-bg-elevated
                border border-border hover:border-border-highlight
                rounded-md transition-colors duration-200
              "
            >
              <X size={14} />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isOverLimit || (!hasChanges && isEditing)}
              className="
                flex items-center gap-1.5 px-3 py-2
                text-sm text-white
                bg-accent-cyan hover:bg-accent-cyan/80
                border border-transparent
                rounded-md transition-colors duration-200
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              <Save size={14} />
              {isEditing ? 'Update' : 'Save'}
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

NoteInputModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
  aircraftId: PropTypes.string,
  existingNote: PropTypes.string,
};

export default NoteInputModal;
