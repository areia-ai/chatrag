import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class',
  theme: {
  	extend: {
  		colors: {
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
  		typography: {
  			DEFAULT: {
  				css: {
  					color: 'inherit',
  					lineHeight: '1.75',
  					a: {
  						color: 'inherit',
  						'&:hover': {
  							color: 'inherit'
  						}
  					},
  					'ul > li': {
  						paddingLeft: '1.5em',
  						position: 'relative',
  						'&::before': {
  							display: 'none'
  						}
  					},
  					'ol > li': {
  						paddingLeft: '0.5em',
  						position: 'relative'
  					},
  					li: {
  						marginTop: '0.5em',
  						marginBottom: '0.5em'
  					},
  					p: {
  						marginTop: '1em',
  						marginBottom: '1em'
  					}
  				}
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'scroll-bounce': {
  				'0%, 100%': { 
  					transform: 'translate(-50%, 0)' 
  				},
  				'50%': { 
  					transform: 'translate(-50%, -6px)' 
  				}
  			},
  			'marquee': {
  				'0%': { transform: 'translateX(0%)' },
  				'10%': { transform: 'translateX(0%)' },
  				'90%': { transform: 'translateX(-50%)' },
  				'100%': { transform: 'translateX(-50%)' }
  			}
  		},
  		animation: {
  			'scroll-bounce': 'scroll-bounce 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite',
  			'marquee': 'marquee 10s linear infinite'
  		}
  	}
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
    require('tailwind-scrollbar')({ nocompatible: true }),
  ],
} satisfies Config;
