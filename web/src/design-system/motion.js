/**
 * Framer Motion animation presets for consistent motion design
 */

// Easing configurations
export const easings = {
  smooth: [0.4, 0, 0.2, 1],
  spring: {
    type: 'spring',
    stiffness: 400,
    damping: 30,
  },
  bounce: {
    type: 'spring',
    stiffness: 600,
    damping: 15,
  },
};

// Duration values in seconds
export const durations = {
  fast: 0.15,
  normal: 0.25,
  slow: 0.4,
};

// Fade in animation variant
export const fadeIn = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: {
      duration: durations.normal,
      ease: easings.smooth,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: durations.fast,
      ease: easings.smooth,
    },
  },
};

// Slide up animation variant
export const slideUp = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: durations.normal,
      ease: easings.smooth,
    },
  },
  exit: {
    opacity: 0,
    y: 20,
    transition: {
      duration: durations.fast,
      ease: easings.smooth,
    },
  },
};

// Scale in animation variant
export const scaleIn = {
  initial: {
    opacity: 0,
    scale: 0.9,
  },
  animate: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: durations.normal,
      ease: easings.smooth,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.9,
    transition: {
      duration: durations.fast,
      ease: easings.smooth,
    },
  },
};

// Stagger container variant for orchestrating children animations
export const staggerContainer = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

// Stagger item variant for use with staggerContainer
export const staggerItem = {
  initial: {
    opacity: 0,
    y: 10,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: durations.normal,
      ease: easings.smooth,
    },
  },
  exit: {
    opacity: 0,
    y: 10,
    transition: {
      duration: durations.fast,
      ease: easings.smooth,
    },
  },
};

// Reduced motion variant for accessibility (prefers-reduced-motion)
export const reducedMotion = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: {
      duration: 0,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0,
    },
  },
};

/**
 * Returns appropriate motion props based on reduced motion preference
 * @param {boolean} prefersReducedMotion - Whether the user prefers reduced motion
 * @param {object} defaultVariant - The default variant to use when motion is allowed
 * @returns {object} The appropriate variant object
 */
export function getMotionProps(prefersReducedMotion, defaultVariant = fadeIn) {
  if (prefersReducedMotion) {
    return reducedMotion;
  }
  return defaultVariant;
}
