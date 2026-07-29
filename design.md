# Earthora Farms — Design System & UI Architecture

> Last updated: 2026-07-29  
> Stack: React 19 · TypeScript · Vite · TailwindCSS v4 · Wouter · TanStack Query · Supabase · Framer Motion · Lucide Icons

---

## 🌿 Brand Identity
- **Company:** Earthora Farms
- **Tagline:** Pure. Potent. Alive.
- **Tone:** Organic, premium, botanical, nature-first, state-of-the-art
- **Core Product Focus:** Single-origin organic Moringa (tablets & powder) direct from our farm to consumers.

---

## 🎨 Color Palette (HSL & Design Tokens)

### Light Theme (Default Warm Cream & Botanical)
| Token | HSL Value | Hex Approx | Usage |
|---|---|---|---|
| `--background` | `45 29% 97%` | `#FAF8F3` | Page background — warm cream |
| `--foreground` | `140 30% 12%` | `#15271D` | Primary body text & headings — deep forest green |
| `--primary` | `140 40% 25%` | `#26593B` | Botanical green — buttons, active states, key accents |
| `--primary-foreground` | `45 29% 97%` | `#FAF8F3` | Contrast text on primary elements |
| `--secondary` | `75 40% 85%` | `#DCE7C5` | Soft sage — tag backgrounds, secondary pills |
| `--secondary-foreground` | `140 30% 12%` | `#15271D` | Text on secondary elements |
| `--accent` | `35 70% 60%` | `#DC9950` | Warm amber — badges, highlights, warm accents |
| `--accent-foreground` | `45 29% 97%` | `#FAF8F3` | Text on amber highlights |
| `--card` | `45 30% 100%` | `#FFFFFF` | Form cards, order summaries, elevated surfaces |
| `--muted` | `140 10% 90%` | `#E1E8E3` | Muted backgrounds, hover fill states |
| `--border` | `140 20% 85%` | `#CFDCD3` | Dividers, input outlines |

### Dark Theme (Deep Forest & Glassmorphic)
| Token | HSL Value | Usage |
|---|---|---|
| `--background` | `140 30% 8%` | Deepest forest dark background |
| `--foreground` | `45 29% 95%` | Crisp light text |
| `--card` | `140 25% 12%` | Dark elevated card containers |
| `--primary` | `140 45% 40%` | Vibrant leaf green accent |

---

## ✒️ Typography & Fonts

### Font Families
- **Font Sans:** `Outfit`, sans-serif (Weights: 300, 400, 500, 600, 700) — navigation, body text, badges, input fields, interactive UI.
- **Font Serif:** `Playfair Display`, serif (Weights: 400, 500, 600, italic) — luxury hero headings, section titles, product highlights.

### Scale Guidelines
- `text-[10px]` / `text-xs`: Form hints, status tags, pill badges, metadata.
- `text-sm` / `text-base`: Navigation links, input values, body descriptions.
- `text-lg` / `text-xl`: Price tags, card titles, section leads.
- `text-3xl` / `text-4xl` / `text-6xl`: Page title headings, hero claims.

---

## 📐 Layout & Radius System
- **Container Max:** `max-w-7xl` (1280px) for standard pages; `max-w-md` / `max-w-xl` for auth and modals.
- **Section Padding:** `py-20` / `py-32`
- **Border Radius:**
  - Inputs & Buttons: `rounded-lg` (8px) / `rounded-xl` (12px)
  - Cards & Containers: `rounded-2xl` (16px) / `rounded-3xl` (24px)
  - Badges & Pills: `rounded-full`

---

## 🛍️ Interactive & Form Component System

### 1. Custom Country Selector (`src/pages/checkout.tsx`)
- **Trigger Element:** Modern custom button matching input dimensions (`px-3.5 py-2.5 rounded-lg border-border/60`). Includes flag emoji + full country name on the left and an animated `<ChevronDown />` on the right.
- **Popover Dropdown:** Floating card elevated with shadow (`shadow-xl`), rounded corners (`rounded-xl`), blur backdrop (`backdrop-blur-md`), max height scrolling (`max-h-60 overflow-y-auto`), and click-outside backdrop dismissal.
- **Selection Highlight:** Selected country highlighted with `bg-primary/10 text-primary font-semibold` and `<Check />` icon.
- **Supported Countries:** India 🇮🇳, United States 🇺🇸, United Kingdom 🇬🇧, Canada 🇨🇦, Australia 🇦🇺, Germany 🇩🇪, France 🇫🇷, UAE 🇦🇪, Singapore 🇸🇬, Other 🌐.

### 2. Smart Validation & Submit Guards
- **Phone Validation:** Country-specific regex check on `onBlur` & submit. Displays gray hint (`text-[10px] text-foreground/45 mt-1`) and destructive toast on failure.
- **Postal Code Validation:** Country-specific regex check on `onBlur` & submit. Displays gray hint and destructive toast on failure.
- **Country Change Reset:** Reset `phone` and `postalCode` state automatically on country switch with an informative user toast.

### 3. Responsive Navigation (`src/components/layout/Navbar.tsx`)
- **Desktop Navbar:** Floating header, transparent → `backdrop-blur-md` on scroll.
- **Mobile Menu:** Slide-down drawer with scroll lock (`document.body.style.overflow = "hidden"`) when active to prevent background scrolling.

---

## 🎬 Animations & Motion Design (Framer Motion)
- **Entrance Easing:** `[0.16, 1, 0.3, 1]` — smooth luxury deceleration.
- **Page Transitions:** Staggered child entrance (`staggerChildren: 0.1`).
- **Interactive Feedback:** Micro-scaling on button clicks (`whileTap={{ scale: 0.98 }}`), smooth dropdown rotations (`rotate-180`).

---

## 🗺️ Page Architecture Overview

```
/ (Home)
├── Hero           — Parallax background video with brand manifesto CTA
├── Origin         — Farm story, visual media
├── Products       — Catalogue preview cards with quick add-to-cart
├── Health         — Key health benefits grid
└── Footer         — Brand links, newsletter

/our-product       — Full catalogue, category filters, product details
/checkout          — 2-column layout: Form (smart validation, custom country popover) + Order Review & Payment (COD / Razorpay)
/cart              — Cart drawer / full page drawer with discount coupon support
/contact           — Direct contact form with Edge Function / Resend dual email notifications
/recipes           — Organic Moringa recipe collection with filter pills
/gallery           — High-res farm photo gallery
```
