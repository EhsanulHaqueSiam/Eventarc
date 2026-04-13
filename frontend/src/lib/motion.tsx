import { motion, AnimatePresence, type Variants } from "motion/react";
import { useReducedMotion } from "motion/react";
import type { ComponentProps } from "react";

// Easing curves — confident, professional, no bounce
const easeOutQuart = [0.25, 1, 0.5, 1] as const;
const easeOutExpo = [0.16, 1, 0.3, 1] as const;

// Shared animation presets for "calm confidence" brand
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3, ease: easeOutQuart } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: easeOutQuart } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.2 } },
};

export const fadeSlideDown: Variants = {
  hidden: { opacity: 0, y: -8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOutQuart } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.25, ease: easeOutExpo } },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15 } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: easeOutQuart } },
};

/**
 * Page-level wrapper that fades in content with a subtle upward slide.
 * Respects prefers-reduced-motion by skipping animation.
 */
export function PageTransition({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const shouldReduce = useReducedMotion();
  if (shouldReduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
    >
      {children}
    </motion.div>
  );
}

/**
 * Staggered list container — children animate in one by one.
 */
export function StaggerList({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const shouldReduce = useReducedMotion();
  if (shouldReduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={staggerContainer}
    >
      {children}
    </motion.div>
  );
}

/**
 * Individual stagger item — must be a child of StaggerList.
 */
export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerItem}>
      {children}
    </motion.div>
  );
}

/**
 * AnimatePresence wrapper for conditional rendering.
 */
export function PresenceGroup({
  children,
  ...props
}: ComponentProps<typeof AnimatePresence>) {
  return <AnimatePresence {...props}>{children}</AnimatePresence>;
}

// Re-export motion and AnimatePresence for direct use
export { motion, AnimatePresence };
