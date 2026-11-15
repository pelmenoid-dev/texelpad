import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Pipette } from 'lucide-react';
import { grayHex } from '../palettes';
type HSV = {
  h: number;
  s: number;
  v: number;
};
export function hexToHsv(hex: string): HSV {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255),
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {
    h: h * 60,
    s: max === 0 ? 0 : d / max,
    v: max
  };
}
export function hsvToHex({
  h,
  s,
  v
}: HSV) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return '#' + channel(5) + channel(3) + channel(1);
}
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export function GrayPicker({
  color,
  onChange,
  onPick
}: {
  color: string;
  onChange: (color: string) => void;
  onPick: () => void;
}) {
  const value = parseInt(color.slice(1, 3), 16);
  return <>
    <input
      className="hue-slider gray-slider"
      type="range"
      min={0}
      max={255}
      step={1}
      value={value}
      aria-label="Intensity"
      aria-valuetext={`${Math.round(value / 255 * 100)}%`}
      onChange={e => onChange(grayHex(Number(e.target.value) / 255))}
    />
    <div className="color-value-row">
      <label className="color-hex">
        <span>Value</span>
        <span className="color-preview" style={{
          background: color
        }} />
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          aria-label="Intensity percent"
          value={Math.round(value / 255 * 100)}
          onChange={e => {
            if (e.target.value !== '') onChange(grayHex(Number(e.target.value) / 100));
          }}
        />
        <span>%</span>
      </label>
      <button
        type="button"
        className="icon-button color-pick"
        aria-label="Pick from model"
        title="Pick from model"
        onClick={onPick}
      >
        <Pipette size={16} />
      </button>
    </div>
  </>;
}
export function ColorPicker({
  color,
  onChange,
  onPick
}: {
  color: string;
  onChange: (color: string) => void;
  onPick: () => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(color)),
    [hex, setHex] = useState(color.toUpperCase());
  const emitted = useRef(color);
  const pointer = useRef<number | undefined>(undefined);
  const plane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const release = () => {
      const id = pointer.current;
      pointer.current = undefined;
      if (id !== undefined && plane.current?.hasPointerCapture(id)) plane.current.releasePointerCapture(id);
    };
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('blur', release);
      release();
    };
  }, []);
  useEffect(() => {
    setHex(color.toUpperCase());
    if (color !== emitted.current) {
      setHsv(previous => {
        const next = hexToHsv(color);
        return {
          ...next,
          h: next.s === 0 ? previous.h : next.h
        };
      });
      emitted.current = color;
    }
  }, [color]);
  const change = (next: HSV) => {
    setHsv(next);
    const value = hsvToHex(next);
    emitted.current = value;
    setHex(value.toUpperCase());
    onChange(value);
  };
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    change({
      ...hsv,
      s: clamp((e.clientX - r.left) / r.width),
      v: 1 - clamp((e.clientY - r.top) / r.height)
    });
  };
  return <>
    <div
      ref={plane}
      className="color-plane"
      style={{
        backgroundColor: `hsl(${hsv.h} 100% 50%)`
      }}
      role="slider"
      tabIndex={0}
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={`${Math.round(hsv.s * 100)}% saturation, ${Math.round(hsv.v * 100)}% brightness`}
      onPointerDown={e => {
        if (e.button !== 0 || !e.isPrimary || pointer.current !== undefined) return;
        e.preventDefault();
        pointer.current = e.pointerId;
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        point(e);
      }}
      onPointerMove={e => {
        if (pointer.current === e.pointerId && e.currentTarget.hasPointerCapture(e.pointerId)) point(e);
      }}
      onPointerUp={e => {
        if (pointer.current !== e.pointerId) return;
        pointer.current = undefined;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={e => {
        if (pointer.current === e.pointerId) pointer.current = undefined;
      }}
      onLostPointerCapture={e => {
        if (pointer.current === e.pointerId) pointer.current = undefined;
      }}
      onKeyDown={e => {
        const step = e.shiftKey ? .1 : .01;
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          change({
            ...hsv,
            s: e.key === 'Home' ? 0 : e.key === 'End' ? 1 : clamp(hsv.s + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0)),
            v: clamp(hsv.v + (e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0))
          });
        }
      }}
    >
      <span
        className="color-plane-handle"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: color
        }}
      />
    </div>
    <input
      className="hue-slider"
      type="range"
      min={0}
      max={360}
      step={1}
      value={hsv.h}
      aria-label="Hue"
      aria-valuetext={`${Math.round(hsv.h)} degrees`}
      onChange={e => change({
        ...hsv,
        h: Number(e.target.value)
      })}
    />
    <div className="color-value-row">
      <label className="color-hex">
        <span>HEX</span>
        <span className="color-preview" style={{
          background: color
        }} />
        <input
          aria-label="Hex color"
          value={hex}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={e => {
            const value = e.target.value;
            setHex(value);
            const normalized = value.startsWith('#') ? value : '#' + value;
            if (/^#[a-f0-9]{6}$/i.test(normalized)) onChange(normalized.toLowerCase());
          }}
          onBlur={() => setHex(color.toUpperCase())}
        />
      </label>
      <button
        type="button"
        className="icon-button color-pick"
        aria-label="Pick from model"
        title="Pick from model"
        onClick={onPick}
      >
        <Pipette size={16} />
      </button>
    </div>
  </>;
}
