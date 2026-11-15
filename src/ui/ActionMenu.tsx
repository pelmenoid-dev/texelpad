import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
type Action = {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  shortcut?: string;
};
type Props = {
  label: string;
  trigger: ReactNode;
  actions: Action[];
  info?: ReactNode;
  disabled?: boolean;
  className?: string;
  triggerClass?: string;
  title?: string;
  onOpen?: () => void;
  closeKey?: unknown;
};
export function ActionMenu({
  label,
  trigger: content,
  actions,
  info,
  disabled,
  className = '',
  triggerClass = 'project-menu-trigger',
  title,
  onOpen,
  closeKey
}: Props) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({
      left: 0,
      top: 0
    });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null),
    last = useRef(false),
    id = useId();
  const items = () => Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus({
      preventScroll: true
    });
  };
  const expand = (fromEnd = false) => {
    last.current = fromEnd;
    onOpen?.();
    setOpen(true);
  };
  useEffect(() => {
    setOpen(false);
  }, [disabled, closeKey]);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const place = () => {
      if (!trigger.current || !menu.current) return;
      const r = trigger.current.getBoundingClientRect();
      setPosition({
        left: Math.max(12, Math.min(r.left, innerWidth - menu.current.offsetWidth - 12)),
        top: Math.max(12, Math.min(r.bottom + 6, innerHeight - menu.current.offsetHeight - 12))
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(menu.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, trigger]);
  useEffect(() => {
    if (!open) return;
    const buttons = items();
    (last.current ? buttons.at(-1) : buttons[0])?.focus({
      preventScroll: true
    });
    const inside = (target: Node) => menu.current?.contains(target) || trigger.current?.contains(target);
    const outside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (inside(target)) return;
      if (target.closest('.viewport')) {
        e.preventDefault();
        e.stopPropagation();
        trigger.current?.focus({
          preventScroll: true
        });
      }
      setOpen(false);
    };
    const focus = (e: FocusEvent) => {
      if (!inside(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focus);
    };
  }, [open, trigger]);
  return <div className={`action-menu ${className}`}>
    <button
      ref={trigger}
      type="button"
      className={triggerClass}
      aria-label={label}
      title={title}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      disabled={disabled}
      onClick={() => open ? close() : expand()}
      onKeyDown={e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          expand(e.key === 'ArrowUp');
        }
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          close(true);
        }
      }}
    >
      {content}
    </button>
    {open && createPortal(<div
      ref={menu}
      id={id}
      className="command-menu"
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && ['s', 'o', 'z', 'y'].includes(e.key.toLowerCase())) {
          close(true);
          return;
        }
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          close(true);
          return;
        }
        if (e.key === 'Tab') {
          close(true);
          return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          const buttons = items(),
            index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {info && <div className="command-menu-info" role="presentation">{info}</div>}
      {actions.map(action => <button
        type="button"
        key={action.label}
        role="menuitem"
        tabIndex={-1}
        disabled={action.disabled}
        onClick={() => {
          close(true);
          action.onSelect();
        }}
      >
        {action.icon}
        <span>{action.label}</span>
        {action.shortcut && <kbd aria-hidden="true">{action.shortcut}</kbd>}
      </button>)}
    </div>, document.body)}
  </div>;
}
