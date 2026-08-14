'use client';

/**
 * The two small pieces every section on the landing page uses: a wrapper that
 * reveals its children on scroll, and a figure that counts up when it arrives.
 *
 * Both exist so app/page.tsx can stay readable. Without them every section
 * would carry its own ref plumbing and the markup would be mostly hooks.
 */

import { useCallback, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { prefersReducedMotion, useReveal, useRevealWith } from './useReveal';

type RevealProps = {
  children: ReactNode;
  /** Milliseconds to hold before this element's transition starts. */
  delay?: number;
  /** 'y' rises into place, 'x' slides in from the left, 'fade' does not move. */
  from?: 'y' | 'x' | 'fade';
  className?: string;
  as?: ElementType;
};

export function Reveal({ children, delay = 0, from = 'y', className, as }: RevealProps) {
  const ref = useReveal(delay);
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag ref={ref} data-reveal={from === 'y' ? '' : from} className={className}>
      {children}
    </Tag>
  );
}

/**
 * A hairline that draws itself across its container once in view.
 *
 * Only scaleX animates, so the rule occupies its full width in layout from the
 * first frame and nothing around it moves while it draws.
 */
export function DrawRule({ delay = 0, className = '', style }: { delay?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useReveal(delay);
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-decorative
      className={`rule-draw block h-px ${className}`}
      style={{ background: 'var(--border-2)', ...style }}
    />
  );
}

const EASE_OUT_EXPO = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * A number that ticks from zero to its value the first time it is seen.
 *
 * Digits are tabular, so the text swaps every frame without the element's box
 * ever changing width. That matters more than it sounds: a proportional-figure
 * count-up shoves whatever sits beside it back and forth for a full second.
 */
export function CountUp({
  to,
  duration = 1100,
  pad = 0,
  className,
  style,
}: {
  to: number;
  duration?: number;
  /** Zero-pad to this many digits, matching the existing padStart(2, '0') figures. */
  pad?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Always zero on first render, matching the server. useRevealWith fires
  // onEnter synchronously under reduced motion, so the final value lands on
  // the first client pass anyway, without a hydration mismatch.
  const [value, setValue] = useState(0);
  const frame = useRef(0);

  const start = useCallback(() => {
    if (prefersReducedMotion()) {
      setValue(to);
      return;
    }
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / duration);
      setValue(Math.round(EASE_OUT_EXPO(t) * to));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [to, duration]);

  const ref = useRevealWith(start);

  // The count can still be mid-flight when the reader navigates away.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return (
    <span
      ref={ref}
      data-reveal="fade"
      className={className}
      style={{ fontVariantNumeric: 'tabular-nums', ...style }}
    >
      {pad ? String(value).padStart(pad, '0') : value}
    </span>
  );
}
