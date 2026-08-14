'use client';

/**
 * Scroll reveal, one observer for the whole page.
 *
 * The landing page reveals somewhere north of a hundred elements. Giving each
 * one its own IntersectionObserver is the obvious implementation and the wrong
 * one: observers are not free, and a hundred of them firing during a fast
 * scroll is measurably worse than one observer with a hundred targets. So a
 * single module-level observer is created lazily on first use and shared.
 *
 * Revealing is one-way. An element that has arrived keeps its .is-in class and
 * is unobserved immediately, because content that fades back out when the
 * reader scrolls up reads as a bug rather than an effect.
 *
 * Nothing here touches React state. The class lands on the DOM node directly,
 * so a reveal costs no render.
 */

import { useCallback, useSyncExternalStore } from 'react';

/** Matches the CSS: the class the stylesheet treats as "arrived". */
const IN = 'is-in';

let observer: IntersectionObserver | null = null;

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Imperative read, for the ref callbacks and rAF loops below. Not for render.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * The reduced-motion preference, safe to branch on during render.
 *
 * A component cannot just call matchMedia in a state initialiser: the server
 * has no such API, so a reader who has the preference set would get different
 * markup on each side and a hydration mismatch. useSyncExternalStore is the
 * sanctioned shape for exactly this. The server snapshot is false, so the
 * server always emits the animated markup and the client corrects it on its
 * first pass. Subscribing also means toggling the OS setting takes effect
 * without a reload.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;
  observer = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add(IN);
        observer?.unobserve(entry.target);
      }
    },
    {
      // Fire a little before the element's top edge clears the viewport bottom,
      // so the transition is already underway by the time it is properly in
      // view rather than starting the moment the reader looks at it.
      rootMargin: '0px 0px -12% 0px',
      threshold: 0.05,
    },
  );
  return observer;
}

/**
 * Ref callback that reveals the node it is attached to.
 *
 * Usage: `<div data-reveal ref={useReveal()}>`, optionally with a stagger:
 * `<div data-reveal ref={useReveal(120)}>` delays the transition by 120ms.
 *
 * React calls the callback with null on unmount, which is where the node is
 * released; there is no cleanup to do beyond that because the observer drops
 * its target as soon as the element arrives.
 */
export function useReveal(delayMs = 0) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;

      if (delayMs) node.style.setProperty('--reveal-delay', `${delayMs}ms`);

      // Reduced motion skips the observer entirely: no rAF, no callbacks, no
      // scroll work at all. The element is simply already there.
      if (prefersReducedMotion()) {
        node.classList.add(IN);
        return;
      }

      // Already revealed (a re-mount, or a fast scroll that beat hydration).
      if (node.classList.contains(IN)) return;

      getObserver().observe(node);
    },
    [delayMs],
  );
}

/**
 * Reveal a node and run a callback the first time it enters view.
 *
 * Used by the pieces that need to *start* something on arrival rather than
 * just transition into place: the count-up figures, the typed evidence
 * blocks. The callback fires at most once.
 */
export function useRevealWith(onEnter: () => void, delayMs = 0) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;

      if (delayMs) node.style.setProperty('--reveal-delay', `${delayMs}ms`);

      if (prefersReducedMotion()) {
        node.classList.add(IN);
        onEnter();
        return;
      }

      if (node.classList.contains(IN)) return;

      // A dedicated observer, because this variant needs a per-node callback
      // and the shared one deliberately carries no per-target state. There are
      // only a handful of these on the page.
      const io = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add(IN);
            io.disconnect();
            onEnter();
          }
        },
        { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
      );
      io.observe(node);
    },
    [onEnter, delayMs],
  );
}
