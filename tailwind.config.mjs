/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Identité Book'nPay — navy / mint green
        navy: {
          950: '#0f172a',
          900: '#1e293b',
          800: '#334155',
        },
        mint: {
          400: '#6ee7b7',
          500: '#34d399',
          600: '#10b981',
        },
      },
    },
  },
  plugins: [],
};
