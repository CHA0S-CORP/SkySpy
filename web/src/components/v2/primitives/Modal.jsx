import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './Icon';

/**
 * Modal dialog skinned to the design (overlay + --bg1 card, radius 14).
 * Radix supplies focus trap, ESC, and scroll lock.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.children]
 * @param {string} [props.width] - CSS width override for the dialog card
 */
export function Modal({ open, onOpenChange, title, children, width }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="v2-modal-overlay v2-app">
          <Dialog.Content className="v2-modal" style={width ? { width } : undefined}>
            <div className="v2-modal__head">
              <Dialog.Title asChild>
                <div className="v2-modal__title">{title}</div>
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" className="v2-iconbtn" aria-label="Close">
                  <Icon name="x" size={16} />
                </button>
              </Dialog.Close>
            </div>
            <div className="v2-modal__body">{children}</div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
