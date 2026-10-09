/** @tailwind config for the Turf design system.
 *
 * Turf is the app's atomic design layer: every colour a component uses is declared
 * here once, so the same token renders identically in the web build, the Capacitor
 * Android shell and (later) an iOS shell. Never hard-code a hex value in a screen —
 * add or reuse a token instead.
 *
 *   turf-*   brand red: wordmark, selection ring, live, destructive
 *   ink-*    the neutral scale — light surfaces (card/soft/line) and the dark
 *            numerics (800-950) used by the broadcast panels
 *   neon-*   pitch green: the join action, positive deltas, in-XI confirmations
 *   trophy-* prize money and winner moments only
 *   zinc-*   neutral greys. Role split by intent: 50-300 are surfaces and hairlines,
 *            400-500 are muted text, 600-950 are strong text and dark panels.
 *
 * The light theme is deliberately paired with dark "broadcast" panels (zinc-950/900/800,
 * ink-950/900): the live centre and the winners board read as a different instrument
 * from the contest lobby.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  /**
   * TURF DESIGN TOKENS (v1.8 light direction)
   * Brand #ED1B24 on a cool near-white canvas with pitch-green as the entry action
   * and trophy gold reserved for prize moments. Screens consume these tokens through
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
        // ---- Turf brand red (#ED1B24): wordmark, selected fixture, live, destructive
        turf: {
          DEFAULT: '#ED1B24',
          red: '#ED1B24',
          'red-dark': '#C6121A',
          'red-deep': '#8E0C12',
          'red-soft': 'rgba(237,27,36,0.10)',
          'red-line': 'rgba(237,27,36,0.28)',
          fire: '#FF4B52',
          ember: '#FF8A8F'
        },
        // ---- Neutral scale: light surfaces plus the dark numerics broadcasts use
        ink: {
          DEFAULT: '#0B0E13',
          soft: '#F1F4F8',
          card: '#FFFFFF',
          line: '#E4E8EE',
          muted: '#666F7B',
          950: '#0B0E13',
          900: '#141A21',
          850: '#1C232C',
          800: '#262E38',
          700: '#3A4450',
          600: '#5A6472',
          500: '#7A838F'
        },
        // ---- Pitch green: the entry action, positive deltas, in-XI confirmations
        neon: {
          DEFAULT: '#0A7A44',
          bright: '#16A34A',
          air: '#4ADE80',
          deep: '#065C33',
          soft: 'rgba(10,122,68,0.12)'
        },
        // ---- Trophy gold: prize moments. `dark` is the light-surface text tier.
        trophy: {
          DEFAULT: '#F2B632',
          light: '#FFD35C',
          dark: '#9A6708',
          deep: '#6E4A05',
          soft: 'rgba(242,182,50,0.18)'
        },
        // Cool near-white canvas, hairlines, then the text greys.
        zinc: {
          50: '#FAFBFC',
          100: '#F3F5F8',
          200: '#E7EAEF',
          300: '#C9D0D9',
          400: '#7A838F',
          500: '#666F7B',
          600: '#4C5561',
          700: '#39424C',
          800: '#232A33',
          900: '#141A21',
          950: '#0B0E13'
        },
        /**
         * The app already uses emerald-* in ~50 places for the "money / positive /
         * confirmed" language. Retinted onto the pitch-green ramp so the light theme
         * has exactly one green: emerald-600 === neon.DEFAULT. Screens keep their
         * class names; only the ramp moves.
         */
        emerald: {
          50: '#EAF6EF',
          100: '#D3EFE0',
          200: '#A8DCC0',
          300: '#6FC79A',
          400: '#2FAD70',
          500: '#16A34A',
          600: '#0A7A44',
          700: '#08703E',
          800: '#065C33',
          900: '#044526',
          950: '#022C18'
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
        'glow-turf': '0 8px 20px -10px rgba(237,27,36,0.55)',
        'glow-neon': '0 8px 20px -10px rgba(10,122,68,0.45)',
        'glow-trophy': '0 8px 20px -10px rgba(242,182,50,0.5)',
        card: '0 1px 2px rgba(11,14,19,0.05), 0 10px 24px -16px rgba(11,14,19,0.18)',
        lift: '0 16px 34px -18px rgba(11,14,19,0.30)'
      },
      backgroundImage: {
        // Mowed-outfield stripes: the app's signature texture.
        'turf-field': 'repeating-linear-gradient(180deg, rgba(10,122,68,0.055) 0 28px, rgba(10,122,68,0.014) 28px 56px)',
        'turf-stripe': 'repeating-linear-gradient(115deg, rgba(11,14,19,0.05) 0 2px, transparent 2px 14px)',
        'ground-band': 'repeating-linear-gradient(90deg, rgba(255,255,255,0.13) 0 20px, rgba(255,255,255,0.03) 20px 40px)',
        'air-band': 'repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0 20px, rgba(255,255,255,0.015) 20px 40px)'
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
