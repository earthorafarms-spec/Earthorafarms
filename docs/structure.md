# Earthora Farms — Project Structure

> Last updated: 2026-07-18
> Stack: React 19 · TypeScript · Vite · TailwindCSS v4 · Wouter · TanStack Query · Supabase · Framer Motion

---

## Root Files

| File | Purpose |
|---|---|
| `index.html` | Entry HTML — sets title "Earthora Farms", favicon, Google Fonts preload |
| `vite.config.ts` | Vite config — `@` alias → `src/`, `@assets` → `attached_assets/`, dev server config |
| `tsconfig.json` | TypeScript config — path aliases match vite |
| `package.json` | Dependencies — React 19, Wouter, TanStack Query, Framer Motion, Supabase, Lucide, Radix UI |
| `.env` | Local secrets (gitignored) — Supabase keys, Ollama URL |
| `.env.example` | Template for env variables — safe to commit |
| `components.json` | shadcn/ui config |
| `design.md` | Brand color palette, typography, design tokens reference |
| `structure.md` | **This file** — full project map |

---

## Environment Variables

### Browser-visible (must have `VITE_` prefix)
| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `VITE_OLLAMA_BASE_URL` | URL of the Ollama server (e.g. `http://192.168.1.42:11434`) |
| `VITE_DEV_HOST` | Dev server host (default `127.0.0.1`) |
| `VITE_ALLOWED_HOSTS` | Comma-separated allowed hosts for Vite dev server |

### Server-only (no `VITE_` prefix — never exposed to browser)
| Variable | Purpose |
|---|---|
| `OLLAMA_BASE_URL` | Ollama server URL (for server-side/Edge Functions) |
| `OLLAMA_MODEL` | Ollama model name (default `gemma3:4b`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (admin — never expose) |

---

## Path Aliases
| Alias | Resolves To |
|---|---|
| `@/` | `src/` |
| `@assets/` | `attached_assets/` |

---

## Public Folder (`/public`)

| File | Purpose |
|---|---|
| `favicon.svg` | Green leaf icon on dark green background (#1b4332) |
| `hero_video.mp4` | Homepage hero background video (33 MB) |
| `world-map.svg` | SVG map used in Origin/shipping section |
| `robots.txt` | SEO — allows all crawlers |
| `_redirects` | Netlify SPA redirect rule (`/* /index.html 200`) |
| `_headers` | Netlify response headers (security, caching) |

---

## `src/` — Application Source

### Entry Points
| File | Purpose |
|---|---|
| `main.tsx` | React root mount — renders `<App />` into `#root` |
| `App.tsx` | Router, lazy imports, AdminGate auth guard, ChatWidget global mount |
| `index.css` | Global CSS — Tailwind directives, CSS custom properties, fonts |

---

## Routing Map (`App.tsx`)

All routing uses **Wouter**. All pages are **lazy-loaded** via `React.lazy()`.

### Public Routes
| URL | Component | Notes |
|---|---|---|
| `/` | `pages/home.tsx` | Homepage with hero, sections |
| `/our-product` | `pages/products.tsx` | Product catalogue |
| `/recipes` | `pages/recipes.tsx` | Moringa recipe cards |
| `/health-benefits` | `pages/health-benefits.tsx` | Benefits detail page |
| `/gallery` | `pages/gallery.tsx` | Farm photo gallery |
| `/contact` | `pages/contact.tsx` | Contact form |
| `/cart` | `pages/cart.tsx` | Shopping cart |
| `/auth` | `pages/auth.tsx` | Login / Register page |
| `/*` | Inline 404 | "Page not found" fallback |

### Admin Routes (guarded by `AdminGate`)
| URL | Component | Notes |
|---|---|---|
| `/admin` | — | Redirects to `/admin/dashboard` |
| `/admin/dashboard` | `pages/admin/dashboard.tsx` | Stats overview |
| `/admin/products` | `pages/admin/products.tsx` | Product CRUD |
| `/admin/orders` | `pages/admin/orders.tsx` | Order list |
| `/admin/coupons` | `pages/admin/coupons.tsx` | Discount code management |
| `/admin/chat` | `pages/admin/chat.tsx` | AI chatbot session transcripts |
| `/admin/analytics` | `pages/admin/analytics.tsx` | Sales & traffic analytics |

### Global Component (outside router)
| Component | Notes |
|---|---|
| `components/chat/ChatWidget.tsx` | Floating chatbot bubble — visible on all public pages |

---

## `src/components/`

### `chat/`
| File | Purpose |
|---|---|
| `ChatWidget.tsx` | Floating AI chatbot "Priya" — streams from Ollama, anti-jailbreak guardrails, Supabase telemetry |

### `layout/`
| File | Purpose |
|---|---|
| `Navbar.tsx` | Top navigation bar with mobile menu |
| `Footer.tsx` | Site footer with links and brand info |

### `sections/` (Homepage sections, used in `pages/home.tsx`)
| File | Purpose |
|---|---|
| `Hero.tsx` | Full-screen video hero |
| `Benefits.tsx` | 92 nutrients / moringa benefits grid |
| `Products.tsx` | Homepage product highlight cards |
| `Origin.tsx` | Farm origin story with world map |
| `Ritual.tsx` | "Daily ritual" usage section |
| `CTA.tsx` | Call-to-action banner |

### `ui/` (55 files — shadcn/ui primitives)
Radix UI-based reusable components: `button`, `dialog`, `dropdown-menu`, `select`, `table`, `toast`, `chart`, `sidebar`, `form`, `input`, `badge`, `card`, `carousel`, `calendar`, `tabs`, `accordion`, `sheet`, and more.

### Root components
| File | Purpose |
|---|---|
| `ScrollToTop.tsx` | Scroll window to top on route change |

---

## `src/lib/`
| File | Purpose |
|---|---|
| `supabase.ts` | Supabase client — uses `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| `utils.ts` | `cn()` helper — merges Tailwind class names (clsx + tailwind-merge) |

---

## `src/hooks/`
| File | Purpose |
|---|---|
| `use-toast.ts` | Toast notification state management |
| `use-mobile.tsx` | Breakpoint hook — returns `true` when viewport is mobile |

---

## `src/contexts/`
| File | Purpose |
|---|---|
| `cart-context.tsx` | React context for shopping cart state (items, add, remove, clear) |

---

## `src/pages/`

### Public Pages
| File | Route | Key Features |
|---|---|---|
| `home.tsx` | `/` | Assembles all homepage sections |
| `products.tsx` | `/our-product` | Product cards, size variants, add to cart |
| `recipes.tsx` | `/recipes` | Recipe cards with moringa ingredient highlights |
| `health-benefits.tsx` | `/health-benefits` | Detailed nutrient breakdown, research citations |
| `gallery.tsx` | `/gallery` | Masonry/grid farm photo gallery |
| `contact.tsx` | `/contact` | Contact form (name, email, message) |
| `cart.tsx` | `/cart` | Cart item list, quantity controls, COD note |
| `auth.tsx` | `/auth` | Login + Register tabs with Supabase Auth |
| `not-found.tsx` | — | 404 page (not wired in router — inline fallback used instead) |

### Admin Pages (`src/pages/admin/`)
| File | Route | Key Features |
|---|---|---|
| `layout.tsx` | Wraps all `/admin/*` | Sidebar nav, mobile menu, logout |
| `dashboard.tsx` | `/admin/dashboard` | Order summary, revenue stats |
| `products.tsx` | `/admin/products` | Add/edit/delete products |
| `orders.tsx` | `/admin/orders` | View all customer orders |
| `coupons.tsx` | `/admin/coupons` | Create/manage discount codes |
| `chat.tsx` | `/admin/chat` | Browse chatbot sessions, full transcripts, blocked messages |
| `analytics.tsx` | `/admin/analytics` | Recharts-based sales/traffic analytics |

---

## Admin Authentication (`App.tsx` — `AdminGate`)

- Uses **Supabase Auth** (`signInWithPassword`) — no hardcoded passwords
- Checks `user.app_metadata.role === "admin"` OR `app_metadata.admin === true` OR `app_metadata.roles` array includes `"admin"`
- To grant admin access: Supabase Dashboard → Authentication → Users → select user → Edit `app_metadata`:
  ```json
  { "role": "admin" }
  ```

---

## AI Chatbot System

### Widget (`src/components/chat/ChatWidget.tsx`)
- **Name**: Priya
- **Model**: `gemma3:4b` via Ollama
- **Streaming**: Real-time token streaming via `fetch` + `ReadableStream`
- **Guardrails**:
  - Detects jailbreak attempts (`system override`, `ignore previous`, `act as`, `dan mode`, etc.)
  - Semantic context filter — only allows Earthora/moringa-related questions
  - Blocked queries return a canned redirect message without hitting Ollama
- **Telemetry**: Logs every session + message to Supabase `chat_sessions` and `chat_messages` tables
- **Config**: Set `VITE_OLLAMA_BASE_URL` in `.env` to the Ollama PC's IP

### Ollama Server Setup (other PC)
```cmd
set OLLAMA_HOST=0.0.0.0
set OLLAMA_ORIGINS=*
ollama serve
```
Then update `.env`:
```
VITE_OLLAMA_BASE_URL=http://<OLLAMA_PC_IP>:11434
```

### Database Tables (run in Supabase SQL Editor)
```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_agent TEXT,
  started_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  is_blocked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Supabase Project
- **URL**: `https://ivhmxnixagdjtgjgchmo.supabase.co`
- **Used for**: Auth, chat telemetry (`chat_sessions`, `chat_messages`)

---

## Tech Stack Summary

| Layer | Technology |
|---|---|
| UI Framework | React 19 |
| Language | TypeScript |
| Bundler | Vite 7 |
| Styling | TailwindCSS v4 (`@tailwindcss/vite`) |
| Routing | Wouter 3 |
| Data Fetching | TanStack Query v5 |
| UI Components | shadcn/ui (Radix UI) |
| Animation | Framer Motion 12 |
| Icons | Lucide React |
| Charts | Recharts |
| Auth + DB | Supabase |
| AI Model | Ollama (`gemma3:4b`) |
| Deployment | Netlify (auto-deploy from `main` branch) |
| Git Remote | `https://github.com/Devarsh-Joshi/Earthorafarms.git` |
