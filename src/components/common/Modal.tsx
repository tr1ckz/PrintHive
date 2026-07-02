import React from 'react';

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra class(es) appended to modal-content, e.g. "description-modal" */
  contentClassName?: string;
}

/**
 * The app-standard overlay modal: click outside closes, clicks inside are
 * swallowed, header carries the title and the ✕ button. Markup and class
 * names match the previously copy-pasted pattern exactly (modal-overlay >
 * modal-content > modal-header + modal-body) so styling is unchanged.
 */
const Modal: React.FC<ModalProps> = ({ title, onClose, children, contentClassName }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div
      className={contentClassName ? `modal-content ${contentClassName}` : 'modal-content'}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button className="modal-close" onClick={onClose}>✕</button>
      </div>
      <div className="modal-body">
        {children}
      </div>
    </div>
  </div>
);

export default Modal;
