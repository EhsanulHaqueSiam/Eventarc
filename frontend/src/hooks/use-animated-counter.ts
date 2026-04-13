import { useEffect, useRef, useState } from "react";

const SPRING_STIFFNESS = 120;
const SPRING_DAMPING = 20;
const FRAME_RATE = 1000 / 60;
const VELOCITY_THRESHOLD = 0.01;
const DISPLACEMENT_THRESHOLD = 0.5;

/**
 * Animates a number from its previous value to the target using spring physics.
 * Returns the current display value as a formatted string.
 * Respects prefers-reduced-motion by snapping instantly.
 */
export function useAnimatedCounter(target: number): string {
  const [display, setDisplay] = useState(target);
  const currentRef = useRef(target);
  const velocityRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  // Check motion preference once on mount
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.current = mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      reducedMotion.current = e.matches;
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (reducedMotion.current) {
      currentRef.current = target;
      velocityRef.current = 0;
      setDisplay(target);
      return;
    }

    // Cancel any running animation
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }

    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.064); // Cap at ~16fps min
      lastTime = now;

      const displacement = target - currentRef.current;
      const springForce = SPRING_STIFFNESS * displacement;
      const dampingForce = SPRING_DAMPING * velocityRef.current;
      const acceleration = springForce - dampingForce;

      velocityRef.current += acceleration * dt;
      currentRef.current += velocityRef.current * dt;

      // Settle when close enough
      if (
        Math.abs(displacement) < DISPLACEMENT_THRESHOLD &&
        Math.abs(velocityRef.current) < VELOCITY_THRESHOLD
      ) {
        currentRef.current = target;
        velocityRef.current = 0;
        setDisplay(target);
        rafRef.current = null;
        return;
      }

      setDisplay(Math.round(currentRef.current));
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [target]);

  return display.toLocaleString();
}
