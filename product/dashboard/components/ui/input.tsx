import * as React from 'react';
import { useEffect, useState } from 'react';
import useEvent from 'react-use-event-hook';

import { cn } from '@/lib/utils';
import styles from './input.module.css';

// ─── Types ────────────────────────────────────────────────

type InputProps = React.ComponentProps<'input'> & {
  /** Icon rendered inside the input on the left side */
  icon?: React.ReactNode;
  /** Shared visual treatment for the input surface. */
  variant?: 'default' | 'surface';
  /** Shared text treatment for typed or opaque values. */
  typography?: 'default' | 'mono';
  /** Shared control density. Compact inputs pair with tool-sized actions. */
  density?: 'default' | 'compact';
};

// ─── Input ────────────────────────────────────────────────

function Input({ className, density = 'default', type, icon, typography = 'default', variant = 'default', ...props }: InputProps) {
  const inputClassName = cn(
    'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
    'aria-invalid:ring-destructive/20 aria-invalid:border-destructive',
    variant === 'surface' && styles.surface,
    typography === 'mono' && styles.mono,
    density === 'compact' && styles.compact,
    density === 'compact' && 'h-[30px] px-[9px] text-[10px] md:text-[10px]',
    icon && 'pl-8',
    className,
  );

  if (icon) {
    return (
      <div data-slot="input-wrapper" className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5 text-muted-foreground">
          {icon}
        </div>
        <input
          type={type}
          data-slot="input"
          data-density={density}
          data-typography={typography}
          data-variant={variant}
          className={inputClassName}
          {...props}
        />
      </div>
    );
  }

  return (
    <input
      type={type}
      data-slot="input"
      data-density={density}
      data-typography={typography}
      data-variant={variant}
      className={inputClassName}
      {...props}
    />
  );
}

// ─── useDebounce (internal) ──────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Internal hook: controlled state with debounced onChange callback.
 */
function useDebounceControlledState<T>(opts: {
  initialValue: T;
  onChange: (value: T) => void;
  delay?: number;
  disabled?: boolean;
}) {
  const { initialValue, onChange, delay, disabled } = opts;
  const [internalValue, setInternalValue] = useState<T>(initialValue);
  const debouncedValue = useDebounce(internalValue, delay || 200);

  const onUpdate = useEvent(onChange);

  // Sync external → internal
  useEffect(() => {
    setInternalValue(initialValue);
  }, [initialValue]);

  // Fire debounced callback
  useEffect(() => {
    if (disabled) return;
    if (debouncedValue !== initialValue) {
      onUpdate(debouncedValue);
    }
  }, [debouncedValue, disabled, onUpdate]);

  if (disabled) {
    return { value: internalValue, debouncedValue: internalValue, onChange };
  }

  return { value: internalValue, debouncedValue, onChange: setInternalValue };
}

// ─── DebouncedInput ──────────────────────────────────────

type DebouncedInputProps = InputProps & {
  value: string;
  onValueChange: (value: string) => void;
  /** Debounce delay in ms. @default 200 */
  delay?: number;
};

const DebouncedInput = React.forwardRef<HTMLInputElement, DebouncedInputProps>(
  ({ className, onValueChange, delay, ...props }, ref) => {
    const { value, onChange } = useDebounceControlledState<string>({
      initialValue: props.value,
      delay,
      onChange: onValueChange,
    });

    return (
      <Input
        ref={ref}
        data-slot="debounced-input"
        className={className}
        {...props}
        onChange={(evt) => onChange(evt.target.value)}
        value={value}
      />
    );
  },
);
DebouncedInput.displayName = 'DebouncedInput';

// ─── DebouncedNumberInput ────────────────────────────────

type DebouncedNumberInputProps = Omit<InputProps, 'type' | 'value'> & {
  value: number;
  onValueChange: (valueAsNumber: number) => void;
  /** Debounce delay in ms. @default 200 */
  delay?: number;
};

const DebouncedNumberInput = React.forwardRef<
  HTMLInputElement,
  DebouncedNumberInputProps
>(({ className, onValueChange, delay, ...props }, ref) => {
  const { value, onChange } = useDebounceControlledState<number>({
    initialValue: props.value,
    delay: delay ?? 200,
    onChange: onValueChange,
  });

  return (
    <Input
      ref={ref}
      type="number"
      data-slot="debounced-number-input"
      className={cn('numeric', className)}
      {...props}
      onChange={(evt) => onChange(evt.target.valueAsNumber)}
      value={value}
    />
  );
});
DebouncedNumberInput.displayName = 'DebouncedNumberInput';

// ─── Exports ─────────────────────────────────────────────

export { Input, DebouncedInput, DebouncedNumberInput };
export type { InputProps, DebouncedInputProps, DebouncedNumberInputProps };
