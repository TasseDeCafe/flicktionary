// Tailwind via PostCSS rather than @tailwindcss/vite: the vite plugin is
// incompatible with the rolldown-based vite 8 pinned in the workspace catalog.
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
