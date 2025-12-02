/**
 * PTP Mobile App - Image Assets
 *
 * Centralized configuration for all PTP brand images.
 * These are hosted on the WordPress site and loaded remotely.
 */

// =============================================================================
// Logo
// =============================================================================

export const LOGO = {
  primary: 'https://ptpsummercamps.com/wp-content/uploads/2025/09/PTP-LOGO-1.png',
} as const;

// =============================================================================
// Hero / Featured Images
// =============================================================================

/**
 * High-quality images suitable for backgrounds, headers, and featured sections
 */
export const HERO_IMAGES = [
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1915.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1899.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1886.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/11/BG7A1773.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/09/BG7A7201-2-scaled.jpg',
] as const;

// =============================================================================
// Camp Action Shots
// =============================================================================

/**
 * Action photos from camps - kids playing, training, competing
 */
export const CAMP_ACTION_IMAGES = [
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1874.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1847.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1797.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1790.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1730.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1642.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1595.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1563.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1539.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1520.jpg',
] as const;

// =============================================================================
// Training / Coaching Images
// =============================================================================

/**
 * Photos showing coaching, mentorship, and skill development
 */
export const TRAINING_IMAGES = [
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1804.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1787.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1596.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1463.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/11/BG7A8348.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/11/BG7A7333.jpg',
] as const;

// =============================================================================
// Group / Team Images
// =============================================================================

/**
 * Group shots, team photos, celebrations
 */
export const GROUP_IMAGES = [
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1393.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1356.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1288.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1283.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1281.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1279.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1278.jpg',
  'https://ptpsummercamps.com/wp-content/uploads/2025/12/BG7A1272.jpg',
] as const;

// =============================================================================
// All Images (combined)
// =============================================================================

export const ALL_IMAGES = [
  ...HERO_IMAGES,
  ...CAMP_ACTION_IMAGES,
  ...TRAINING_IMAGES,
  ...GROUP_IMAGES,
] as const;

// =============================================================================
// Specific Use Cases
// =============================================================================

/**
 * Default images for specific screens/components
 */
export const SCREEN_IMAGES = {
  // Login screen background
  loginBackground: HERO_IMAGES[0],

  // Camps screen header
  campsHeader: CAMP_ACTION_IMAGES[0],

  // Training screen header
  trainingHeader: TRAINING_IMAGES[0],

  // Schedule empty state
  scheduleEmpty: GROUP_IMAGES[0],

  // Profile header
  profileHeader: HERO_IMAGES[2],
} as const;

// =============================================================================
// Onboarding Slides
// =============================================================================

export const ONBOARDING_SLIDES = [
  {
    image: HERO_IMAGES[0],
    title: 'Welcome to PTP Soccer',
    subtitle: 'Players Teaching Players - where NCAA and pro athletes coach the next generation',
  },
  {
    image: CAMP_ACTION_IMAGES[2],
    title: 'Summer Camps & Clinics',
    subtitle: 'Join our action-packed camps across PA, NJ, DE, MD, and NY',
  },
  {
    image: TRAINING_IMAGES[0],
    title: 'Private Training',
    subtitle: '1-on-1 mentorship with college and professional soccer players',
  },
  {
    image: GROUP_IMAGES[0],
    title: 'Join the PTP Family',
    subtitle: 'Build skills, make friends, and love the game',
  },
] as const;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a random image from a category
 */
export const getRandomImage = (
  category: 'hero' | 'action' | 'training' | 'group' | 'all' = 'all'
): string => {
  const images = {
    hero: HERO_IMAGES,
    action: CAMP_ACTION_IMAGES,
    training: TRAINING_IMAGES,
    group: GROUP_IMAGES,
    all: ALL_IMAGES,
  }[category];

  return images[Math.floor(Math.random() * images.length)];
};

/**
 * Get multiple random images (non-repeating)
 */
export const getRandomImages = (count: number, category: 'all' | 'hero' | 'action' | 'training' | 'group' = 'all'): string[] => {
  const images = {
    hero: [...HERO_IMAGES],
    action: [...CAMP_ACTION_IMAGES],
    training: [...TRAINING_IMAGES],
    group: [...GROUP_IMAGES],
    all: [...ALL_IMAGES],
  }[category];

  // Shuffle and take first N
  const shuffled = images.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
};
