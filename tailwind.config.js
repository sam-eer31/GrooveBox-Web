/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans',
          'Apple Color Emoji',
          'Segoe UI Emoji',
          'Segoe UI Symbol',
          'Noto Color Emoji'
        ]
      },
      colors: {
        // Grok-inspired aqua accent
        brand: {
          500: "#20E3FF"
        }
      },
      boxShadow: {
        soft: '0 1px 2px 0 rgba(0,0,0,0.05), 0 10px 20px -10px rgba(0,0,0,0.2)'
      }
    }
  },
  plugins: []
}


