import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { ColorPicker, GrayPicker } from './ColorPicker';
import type { Studio } from '../studio';
type Popup = {
  index: number | null;
  draft: string;
  original: {
    color: string;
    value: number;
  };
  anchor: HTMLButtonElement;
};
function swatchInk(color: string) {
  const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > .179 ? '#000000' : '#ffffff';
}
export function ProjectPalette({
  studio
}: {
  studio: Studio;
}) {
  const [popup, setPopup] = useState<Popup | null>(null),
    [picking, setPicking] = useState(false),
    [position, setPosition] = useState({
      left: 0,
      top: 0
    });
  const [touchInput, setTouchInput] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const editHint = touchInput ? 'Long tap to change' : 'Double-click to change';
  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)'),
      update = () => setTouchInput(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const panel = useRef<HTMLDivElement>(null),
    addButton = useRef<HTMLButtonElement>(null),
    titleId = useId(),
    hintId = useId();
  const hold = useRef<{
    timer: number;
    x: number;
    y: number;
  } | null>(null),
    held = useRef(false);
  const clearHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  const kind = studio.active,
    grayscale = kind !== 'diffuse',
    colors = studio.paletteFor(kind),
    current = studio.brushColorFor(kind);
  const duplicate = !!popup && colors.some((c, i) => i !== popup.index && c === popup.draft);
  const open = (index: number | null, anchor: HTMLButtonElement) => {
    const color = index === null ? current : colors[index];
    if (index !== null) studio.setBrushColor(color, kind);
    setPopup({
      index,
      draft: color,
      original: {
        color: studio.brush.color,
        value: studio.brush.value
      },
      anchor
    });
    setPicking(false);
  };
  const change = (color: string) => {
    setPopup(p => p ? {
      ...p,
      draft: color
    } : p);
    studio.setBrushColor(color, kind);
  };
  const dismiss = (save: boolean, focus = true) => {
    if (!popup) return;
    if (save) {
      if (duplicate) return;
      const saved = popup.index === null ? studio.addPaletteColor(popup.draft, kind) : studio.editPaletteColor(popup.index, popup.draft, kind);
      if (!saved) return;
    } else {
      Object.assign(studio.brush, popup.original);
      studio.dirty = true;
      studio.changed();
    }
    studio.cancelColorPick(false);
    setPicking(false);
    setPopup(null);
    if (focus) requestAnimationFrame(() => {
      const anchor = popup.anchor.isConnected ? popup.anchor : addButton.current;
      anchor?.focus();
    });
  };
  const select = (index: number) => {
    if (popup) dismiss(popup.index !== null && !duplicate, false);
    studio.setBrushColor(studio.paletteFor(kind)[index], kind);
  };
  const remove = () => {
    if (popup?.index === null || !popup) return;
    studio.removePaletteColor(popup.index, kind);
    setPopup(null);
    requestAnimationFrame(() => addButton.current?.focus());
  };
  useEffect(() => {
    clearHold();
    held.current = false;
    setPopup(null);
    setPicking(false);
    studio.cancelColorPick(false);
  }, [studio, studio.model]);
  useEffect(() => () => {
    clearHold();
    studio.cancelColorPick(false);
  }, [studio]);
  useLayoutEffect(() => {
    if (!popup || picking || !panel.current) return;
    const place = () => {
      if (!panel.current) return;
      const r = popup.anchor.getBoundingClientRect(),
        w = panel.current.offsetWidth,
        h = panel.current.offsetHeight;
      const edge = popup.anchor.closest('.editor-panel')?.getBoundingClientRect().right ?? r.right;
      const left = innerWidth > 760 && edge + 8 + w <= innerWidth - 12 ? edge + 8 : Math.max(12, Math.min(r.left, innerWidth - w - 12));
      const top = innerWidth > 760 ? r.top : r.bottom + 8;
      setPosition({
        left,
        top: Math.max(12, Math.min(top, innerHeight - h - 12))
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    panel.current.querySelector<HTMLElement>('.color-plane, .gray-slider')?.focus({
      preventScroll: true
    });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [popup?.anchor, picking]);
  useEffect(() => {
    if (!popup || picking) return;
    const outside = (e: globalThis.PointerEvent) => {
      const target = e.target as HTMLElement;
      if (panel.current?.contains(target) || popup.anchor.contains(target)) return;
      // Closing a color editor must not paint a stroke with the same click.
      if (target.closest('.viewport')) {
        e.preventDefault();
        e.stopPropagation();
      }
      dismiss(popup.index !== null && !duplicate, false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });
  const pick = () => {
    setPicking(true);
    studio.pickColorOnce(color => {
      change(color);
      setPicking(false);
    }, () => setPicking(false));
    // Escape while sampling belongs to the studio, not a hidden popup input.
    (document.activeElement as HTMLElement | null)?.blur();
  };
  return <div className="project-palette">
    <div
      className="palette"
      role="group"
      aria-label="Project colors"
      aria-describedby={hintId}
    >
      {colors.map((color, index) => <button
        type="button"
        key={index}
        className={`swatch ${current === color ? 'selected' : ''}`}
        style={{
          background: color,
          color: swatchInk(color)
        }}
        aria-label={`Color ${color}`}
        title={`${color.toUpperCase()} · ${editHint}`}
        aria-pressed={current === color}
        aria-haspopup="dialog"
        aria-expanded={popup?.index === index}
        aria-keyshortcuts="F2"
        onPointerDown={e => {
          clearHold();
          held.current = false;
          if (e.pointerType === 'mouse' || !e.isPrimary || e.button !== 0) return;
          const anchor = e.currentTarget;
          hold.current = {
            x: e.clientX,
            y: e.clientY,
            timer: window.setTimeout(() => {
              hold.current = null;
              held.current = true;
              open(index, anchor);
            }, 500)
          };
        }}
        onPointerMove={e => {
          if (hold.current && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8) clearHold();
        }}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
        onClick={e => {
          if (held.current) {
            e.preventDefault();
            held.current = false;
            return;
          }
          select(index);
        }}
        onDoubleClick={e => open(index, e.currentTarget)}
        onContextMenu={e => {
          e.preventDefault();
          clearHold();
          if (!held.current) {
            held.current = true;
            open(index, e.currentTarget);
          }
        }}
        onKeyDown={e => {
          held.current = false;
          if (e.key === 'F2') {
            e.preventDefault();
            e.stopPropagation();
            open(index, e.currentTarget);
          }
        }}
      >
        {current === color && <Check size={14} />}
      </button>)}
      <button
        ref={addButton}
        type="button"
        className="palette-add"
        aria-label="Add color"
        title={colors.length >= 256 ? 'Palette full (256 colors)' : 'Add color'}
        aria-haspopup="dialog"
        aria-expanded={!!popup && popup.index === null}
        disabled={colors.length >= 256}
        onClick={e => open(null, e.currentTarget)}
      >
        <Plus size={19} />
      </button>
    </div>
    <p className="palette-hint" id={hintId}>{editHint}</p>
    {popup && !picking && createPortal(<div
      ref={panel}
      className="color-popover"
      role="dialog"
      aria-labelledby={titleId}
      style={position}
      onKeyDown={e => {
        if ((e.ctrlKey || e.metaKey) && ['s', 'o'].includes(e.key.toLowerCase())) {
          if (e.key.toLowerCase() === 's' && duplicate) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          dismiss(popup.index !== null && !duplicate, false);
          return;
        }
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          dismiss(false);
        }
        if (e.key === 'Tab') {
          const controls = Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,[tabindex="0"]'));
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div className="color-popover-heading">
        <strong id={titleId}>{popup.index === null ? 'New color' : 'Color'}</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Cancel color editing"
          title="Cancel"
          onClick={() => dismiss(false)}
        >
          <X size={15} />
        </button>
      </div>
      {grayscale ? <GrayPicker color={popup.draft} onChange={change} onPick={pick} /> : <ColorPicker color={popup.draft} onChange={change} onPick={pick} />}
      {duplicate && <p className="color-error" role="status">This color is already in the palette.</p>}
      <div className="color-popover-actions">
        {popup.index !== null && <button
          type="button"
          className="icon-button"
          aria-label="Remove color"
          title="Remove color"
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>}
        <button
          type="button"
          className="button primary"
          disabled={duplicate}
          onClick={() => dismiss(true)}
        >
          {popup.index === null ? 'Add color' : 'Done'}
        </button>
      </div>
    </div>, document.body)}
  </div>;
}
