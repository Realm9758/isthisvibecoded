'use client';

/**
 * The lattice behind the hero.
 *
 * A grid of dim nodes with a bright band sweeping down through it, brightening
 * each node as it passes and letting it decay. It reads as something being
 * looked over, which is the whole pitch, and it is the only place on this page
 * that carries atmosphere rather than information.
 *
 * Cost discipline, because this runs behind a page that is also running a
 * looping demo:
 *
 *  - 30fps, not 60. At this scale nobody can tell, and it halves the work.
 *  - Zero allocation inside the frame loop. Nodes are laid out once into flat
 *    Float32Arrays and only read afterwards.
 *  - The loop stops when the canvas scrolls out of view and when the tab is
 *    hidden. A rAF loop that keeps painting in a background tab is the single
 *    most common way a page like this turns into a battery complaint.
 *  - Reduced motion paints one frame and never starts a loop at all.
 */

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './useReveal';

/** Target spacing between nodes, in CSS pixels. Density falls out of this. */
const SPACING = 44;
/** Seconds for the band to travel from above the canvas to below it. */
const SWEEP_SECONDS = 6.5;
/** How far above and below the band a node still responds, in CSS pixels. */
const BAND_REACH = 130;
const FRAME_MS = 1000 / 30;

export function ScanField({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;

    // Flat node arrays, rebuilt only on resize.
    let xs = new Float32Array(0);
    let ys = new Float32Array(0);
    // Per-node phase offset, so the idle twinkle is not in lockstep.
    let phase = new Float32Array(0);

    let raf = 0;
    let running = false;
    let lastPaint = 0;
    let started = 0;
    let visible = false;

    function layout() {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));

      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      cols = Math.ceil(width / SPACING) + 1;
      rows = Math.ceil(height / SPACING) + 1;
      const count = cols * rows;

      if (xs.length !== count) {
        xs = new Float32Array(count);
        ys = new Float32Array(count);
        phase = new Float32Array(count);
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          // Offset alternate rows so the grid reads as a lattice rather than
          // as graph paper.
          xs[i] = c * SPACING + (r % 2 ? SPACING / 2 : 0);
          ys[i] = r * SPACING;
          // Deterministic pseudo-random phase. A real PRNG is not worth a
          // dependency here and this scatters perfectly well.
          phase[i] = ((i * 2654435761) % 1000) / 1000;
        }
      }
    }

    function paint(elapsedSeconds: number) {
      ctx!.clearRect(0, 0, width, height);

      // Band position: travels from just above the canvas to just below it.
      const t = (elapsedSeconds % SWEEP_SECONDS) / SWEEP_SECONDS;
      const bandY = -BAND_REACH + t * (height + BAND_REACH * 2);

      const count = cols * rows;
      for (let i = 0; i < count; i++) {
        const y = ys[i];
        const distance = Math.abs(y - bandY);

        // Base twinkle keeps the field alive between sweeps.
        const idle = 0.05 + 0.03 * Math.sin(elapsedSeconds * 0.7 + phase[i] * 6.28);

        let alpha = idle;
        let size = 1;
        if (distance < BAND_REACH) {
          // Cosine falloff: brightest on the band, nothing at the edges, and
          // no hard boundary where nodes pop.
          const lit = Math.cos((distance / BAND_REACH) * (Math.PI / 2));
          alpha = idle + lit * lit * 0.62;
          size = 1 + lit * 1.4;
        }

        if (alpha <= 0.055) {
          ctx!.fillStyle = 'rgba(255,255,255,0.05)';
        } else {
          // Lit nodes take the accent; unlit ones stay neutral, so the sweep
          // colours the field rather than the field being blue throughout.
          ctx!.fillStyle = `rgba(96,150,255,${alpha.toFixed(3)})`;
        }
        ctx!.fillRect(xs[i] - size / 2, y - size / 2, size, size);
      }

      // The band's own hairline, brightest in the middle of the canvas.
      const edgeFade = Math.min(1, Math.min(bandY, height - bandY) / 120);
      if (edgeFade > 0) {
        ctx!.fillStyle = `rgba(59,130,246,${(0.16 * edgeFade).toFixed(3)})`;
        ctx!.fillRect(0, bandY, width, 1);
      }
    }

    function frame(now: number) {
      if (!running) return;
      if (now - lastPaint >= FRAME_MS) {
        lastPaint = now;
        paint((now - started) / 1000);
      }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || !visible || document.hidden) return;
      running = true;
      // Rebase the clock so a resumed sweep continues from where it paused
      // rather than jumping to wherever wall-clock time has got to.
      started = performance.now() - started;
      lastPaint = 0;
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      started = performance.now() - started;
    }

    layout();

    if (prefersReducedMotion()) {
      // One frame, mid-sweep, then nothing. Still atmospheric, zero cost.
      paint(SWEEP_SECONDS * 0.5);
      return;
    }

    started = 0;

    const io = new IntersectionObserver(
      entries => {
        visible = entries[0]?.isIntersecting ?? false;
        if (visible) start();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    // Relayout on resize. ResizeObserver rather than a window listener because
    // the canvas is width-constrained by its section, not by the viewport.
    // While paused, `started` holds accumulated elapsed time rather than an
    // origin, so a repaint here reads it directly.
    const ro = new ResizeObserver(() => {
      layout();
      if (!running) paint(started / 1000);
    });
    ro.observe(canvas);

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-decorative
      className={className}
      style={{ pointerEvents: 'none', ...style }}
    />
  );
}
