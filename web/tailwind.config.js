/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Map existing CSS variables to Tailwind colors
        'bg-dark': 'var(--bg-dark)',
        'bg-card': 'var(--bg-card)',
        'bg-hover': 'var(--bg-hover)',
        'border': 'var(--border)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-dim': 'var(--text-dim)',
        'accent-cyan': 'var(--accent-cyan)',
        'accent-green': 'var(--accent-green)',
        'accent-blue': 'var(--accent-blue)',
        'accent-yellow': 'var(--accent-yellow)',
        'accent-red': 'var(--accent-red)',
        'accent-purple': 'var(--accent-purple)',
        'brand-navy': 'var(--brand-navy)',
        'brand-blue': 'var(--brand-blue)',
        'brand-green': 'var(--brand-green)',
        'glow-cyan': 'var(--glow-cyan)',
        'glow-green': 'var(--glow-green)',
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(15px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 15px -5px rgba(0, 212, 255, 0.3)' },
          '50%': { boxShadow: '0 0 25px -5px rgba(0, 212, 255, 0.5)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%)',
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.36)',
        'glow-cyan': '0 0 20px -5px rgba(0, 212, 255, 0.4)',
        'glow-cyan-lg': '0 20px 40px -10px rgba(0, 212, 255, 0.2)',
      },
    },
  },
  plugins: [],
}
