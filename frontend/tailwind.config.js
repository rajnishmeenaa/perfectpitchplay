/** @tailwind config for the Turf design system.
 *
 * Turf is the app's atomic design layer: every colour a component uses is declared
 * here once, so the same token renders identically in the web build, the Capacitor
 * Android shell and (later) an iOS shell. Never hard-code a hex value in a screen —
 * add or reuse a token instead.
 *
 *   turf-*   brand: primary actions, active tabs, entry highlights
 *   ink-*    charcoal surfaces the brand colour sits on
 *   neon-*   live / positive / leading states
 *   trophy-* prize money and winner moments only
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  /**
   * TURF DESIGN TOKENS
   * Brand: #ED1B24 (turf) on charcoal (ink) with neon-green live accents and
   * trophy gold reserved for prize money. Screens consume these tokens through
   * src/components/turf rather than raw hex values.
   */
    // `overline` is a Tailwind utility; without this an app's own eyebrow-label class draws a line above the text.
    blocklist: ["overline"],
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        turf: '0.875rem',
        'turf-pill': '999px'
      },
      colors: {
        // ---- Turf brand red (#ED1B24): primary actions, active tabs, entry highlights
        turf: {
          DEFAULT: '#ED1B24',
          red: '#ED1B24',
          'red-dark': '#C6121A',
          'red-deep': '#8E0C12',
          'red-soft': 'rgba(237,27,36,0.14)',
          'red-line': 'rgba(237,27,36,0.38)',
          fire: '#FF4B52',
          ember: '#FF8A8F'
        },
        // ---- Charcoal / black surfaces
        ink: {
          DEFAULT: '#0A0C11',
          soft: '#0E1117',
          card: '#12151C',
          line: '#272E3A',
          950: '#05060A',
          900: '#0A0C11',
          850: '#12151C',
          800: '#171B23',
          700: '#232A35',
          600: '#3A4352',
          500: '#677282'
        },
        // ---- Neon turf green: live matches, positive deltas, in-XI confirmations
        neon: {
          DEFAULT: '#2BF57C',
          bright: '#6BFFA8',
          deep: '#0B7A43',
          soft: 'rgba(43,245,124,0.14)'
        },
        // ---- Trophy gold stays reserved for prize money and winner moments
        trophy: {
          DEFAULT: '#F2B632',
          light: '#FFD35C',
          dark: '#B97F14',
          soft: 'rgba(242,182,50,0.14)'
        },
        // Remapped to the charcoal scale so the ~1,000 existing zinc-* classes in the
        // app render dark-on-charcoal without touching every screen.
        zinc: {
          50: '#101319',
          100: '#14181F',
          200: '#232A35',
          300: '#3A4352',
          400: '#677282',
          500: '#93A0B0',
          600: '#BCC7D4',
          700: '#D9E1EA',
          800: '#EBF0F5',
          900: '#F6F9FC',
          950: '#FDFEFF'
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))'
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))'
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))'
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))'
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))'
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))'
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))'
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))'
        }
      },
      fontFamily: {
        heading: ['Barlow Condensed', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Barlow', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Barlow Condensed', 'Impact', 'ui-sans-serif', 'sans-serif'],
        num: ['Barlow', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.04em' }]
      },
      boxShadow: {
        'glow-turf': '0 0 26px -6px rgba(237,27,36,0.55)',
        'glow-neon': '0 0 26px -6px rgba(43,245,124,0.55)',
        'glow-trophy': '0 0 26px -6px rgba(242,182,50,0.5)',
        card: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 10px 28px -14px rgba(0,0,0,0.7)',
        lift: '0 14px 34px -18px rgba(237,27,36,0.65)'
      },
      backgroundImage: {
        'turf-field': 'repeating-linear-gradient(180deg, rgba(43,245,124,0.055) 0 28px, rgba(43,245,124,0.015) 28px 56px)',
        'turf-stripe': 'repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 14px)'
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0'
          },
          to: {
            height: 'var(--radix-accordion-content-height)'
          }
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)'
          },
          to: {
            height: '0'
          }
        },
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' }
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' }
        },
        ticker: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(-50%)' }
        },
        pop: {
          '0%': { transform: 'scale(0.6)', opacity: '0' },
          '70%': { transform: 'scale(1.06)' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        // Live-match pulse behind the red LIVE dot.
        blip: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.35', transform: 'scale(1.45)' }
        },
        // Prize pool / rank-change emphasis.
        flash: {
          '0%': { backgroundColor: 'rgba(237,27,36,0.30)' },
          '100%': { backgroundColor: 'transparent' }
        }
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        floaty: 'floaty 5s ease-in-out infinite',
        shimmer: 'shimmer 2.4s linear infinite',
        ticker: 'ticker 22s linear infinite',
        pop: 'pop 0.35s cubic-bezier(0.22,1,0.36,1) both',
        blip: 'blip 1.1s ease-in-out infinite',
        flash: 'flash 1.2s ease-out 1'
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
