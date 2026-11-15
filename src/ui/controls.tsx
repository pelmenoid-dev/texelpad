import * as SliderPrimitive from '@radix-ui/react-slider';
import * as TogglePrimitive from '@radix-ui/react-toggle';
import { useId } from 'react';
import type { CSSProperties, ReactNode } from 'react';

// shadcn's Radix composition, styled with this editor's tokens instead of Tailwind.
export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = .01,
  suffix = '',
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (n: number) => void;
}) {
  const id = useId();
  const progress = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const position = {
    '--slider-position': `${progress * 100}%`,
    '--slider-thumb-offset': .5 - progress
  } as CSSProperties;
  return <div className="slider-field">
    <div className="field-heading">
      <label id={id}>{label}</label>
      <span className="number-field">
        <input
          disabled={disabled}
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          value={Number(value.toFixed(3))}
          onChange={e => {
            const next = e.target.valueAsNumber;
            if (!Number.isFinite(next)) return;
            // Native number inputs allow values between steps when typed.
            // Keep their values consistent with the slider and project format.
            const snapped = min + Math.round((next - min) / step) * step;
            onChange(Number(Math.max(min, Math.min(max, snapped)).toFixed(6)));
          }}
        />
        {suffix && <span>{suffix}</span>}
      </span>
    </div>
    <SliderPrimitive.Root
      disabled={disabled}
      className="slider"
      style={position}
      aria-labelledby={id}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={([n]) => onChange(n)}
    >
      <SliderPrimitive.Track className="slider-track">
        <SliderPrimitive.Range className="slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="slider-thumb" aria-label={`${label}: slider`} />
    </SliderPrimitive.Root>
  </div>;
}
export function Tool({
  label,
  pressed,
  onClick,
  children
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return <TogglePrimitive.Root
    className="tool"
    pressed={pressed}
    onPressedChange={onClick}
    title={label}
    aria-label={label}
  >
    {children}
  </TogglePrimitive.Root>;
}
