import { type ReactNode } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import styles from './dialog.module.css';

export interface DialogFrameProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function DialogFrame({ open, onOpenChange, children }: DialogFrameProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Popup className={styles.popup}>
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

export interface DialogHeaderProps {
  title: string;
  meta?: ReactNode;
  onClose?: () => void;
}

export function DialogHeader({ title, meta, onClose }: DialogHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.headerTitle}>
        <h2 className={styles.title}>{title}</h2>
        {meta && <div className={styles.meta}>{meta}</div>}
      </div>
      {onClose && (
        <BaseDialog.Close className={styles.close} onClick={onClose}>
          ✕
        </BaseDialog.Close>
      )}
    </div>
  );
}

export interface DialogBodyProps {
  children: ReactNode;
}

export function DialogBody({ children }: DialogBodyProps) {
  return <div className={styles.body}>{children}</div>;
}

export interface DialogFooterProps {
  children: ReactNode;
}

export function DialogFooter({ children }: DialogFooterProps) {
  return <div className={styles.footer}>{children}</div>;
}
