# Earthora Farms — Design System

## Brand Identity
- **Company:** Earthora Farms
- **Tagline:** Pure. Potent. Alive.
- **Tone:** Organic, premium, grounded, nature-first

## Color Palette (HSL)
| Token | Value | Usage |
|-------|-------|-------|
| `--background` | `45 29% 97%` | Page bg — warm cream |
| `--foreground` | `140 30% 12%` | Body text — deep green |
| `--primary` | `140 40% 25%` | Botanical green — headings, buttons |
| `--primary-foreground` | `45 29% 97%` | Text on primary — cream |
| `--secondary` | `75 40% 85%` | Soft sage — accent bg |
| `--accent` | `35 70% 60%` | Warm amber — highlights, hover states |
| `--card` | `45 30% 100%` | Cards, elevated surfaces |
| `--muted` | `140 10% 90%` | Subtle backgrounds |
| `--border` | `140 20% 85%` | Borders, dividers |

## Typography
- **Font Sans:** `Outfit` (300, 400, 500, 600) — body, navigation, buttons
- **Font Serif:** `Playfair Display` (400, 500, 600, italic) — headings, titles
- **Scale:** `text-sm` (nav links) → `text-lg`/`text-xl` (body) → `text-4xl`/`text-7xl` (headings)

## Spacing
- Container max: `max-w-7xl` (1280px)
- Section padding: `py-24` / `py-32`
- Grid gap: `gap-8` / `gap-16`
- Card padding: `p-8`

## Components

### Buttons
- **Primary:** `bg-primary text-primary-foreground` — solid botanical green
- **Outline:** `border-primary text-primary` — ghost on light, `border-primary-foreground` on dark
- **Size:** `h-14 px-8 text-lg` for large CTA, default for standard
- **Hover:** subtle opacity shift or scale

### Cards
- **Shape:** `rounded-2xl` overflow-hidden
- **Image aspect:** `aspect-[4/5]` for product cards
- **Shadow:** soft `shadow-lg` / `shadow-sm`

### Navigation
- **Style:** Fixed top, transparent → backdrop-blur on scroll
- **Height:** `h-20`
- **Links:** `text-sm font-medium` with hover opacity transition

### Animations (Framer Motion)
- **Easing:** `[0.16, 1, 0.3, 1]` — smooth deceleration
- **Fade in:** `opacity: 0, y: 20-40` → `opacity: 1, y: 0`
- **Stagger:** `staggerChildren: 0.1` for grids
- **Parallax:** `useScroll` + `useTransform` for image depth
- **Duration:** 0.8–1.2s for entrance, 0.5s for interactions

## Page Structure
```
/
├── Hero          — Full-screen parallax with CTA
├── Origin        — Brand story, visual
├── Products      — 3 product cards (grid)
├── Benefits      — 6 benefit cards (grid)
├── Ritual        — Lifestyle image + text + Explore Recipes
├── CTA           — Final call-to-action
└── Footer        — Links, copyright

/recipes
├── Hero          — Smaller hero for inner page
├── Recipe cards  — Grid of recipe cards
└── Footer

/contact
├── Hero          — Smaller hero for inner page
├── Form + Info   — Contact form + company details sidebar
├── Social links  — Social media follow section
└── Footer
```
