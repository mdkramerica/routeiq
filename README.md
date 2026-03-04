# TerritoryPilot — AI Daily Briefing for Field Sales Reps

> *"Walk in knowing everything. Never wing a sales call again."*

---

## 🎯 The Problem

Field sales reps (territory managers, med-device reps, pharma reps, equipment distributors) drive hundreds of miles a week, bounce between 6–10 accounts a day, and most of them prep for calls by glancing at their phone in the parking lot.

Current tools suck for solo reps:
- SPOTIO / Badger Maps: $100–$150/mo, bloated, team-focused
- CRMs: They log data, they don't brief you
- Google Maps: Zero intelligence, just directions

**The gap:** A focused, affordable AI tool that tells you *who you're seeing today, what to say, and the fastest path between them.*

---

## 💡 The Solution

TerritoryPilot is a mobile-first web app that:

1. **Imports your accounts** (CSV, Google Sheets, or manual)
2. **Plans your day** — optimizes visit order by geography (TSP algorithm)
3. **Briefs you before each stop** — AI-generated 3-sentence "walk-in card" per account: last interaction, what they care about, a conversation opener
4. **Logs calls in 10 seconds** — voice-to-text note after each visit
5. **Sends you a daily recap** — email summary of what happened + tomorrow's top priorities

Everything runs automatically. No manual data entry beyond the initial account import.

---

## 💰 Business Model

### Pricing
| Plan | Price | Who |
|------|-------|-----|
| **Solo** | $29/mo | Individual rep |
| **Team** | $79/mo | Up to 5 reps |
| **Agency** | $199/mo | 6–20 reps + manager dashboard |

Annual discount: 20% off (captures cash upfront, reduces churn)

### Unit Economics (Conservative)
- CAC: ~$40 (Twitter/LinkedIn content + Google Ads on "territory manager app")
- LTV at $29/mo, 18-month avg retention: **$522**
- LTV:CAC ratio: **13:1** — exceptional
- Gross margin: ~85% (OpenAI API costs ~$0.50–2/user/mo)

### Revenue Projections
| Milestone | MRR | Timeline |
|-----------|-----|----------|
| 10 customers | $290 | Week 2 |
| 50 customers | $1,450 | Month 2 |
| 200 customers | $5,800 | Month 6 |
| 500 customers | $14,500 | Month 12 |

**Year 1 target: $10K MRR = $120K ARR** — realistic with focused LinkedIn/Reddit outreach to field sales communities.

---

## 🎯 Target Customer

**Primary:** Territory managers in:
- Medical devices / pharma
- B2B equipment (HVAC, safety, industrial)
- Food & beverage distribution
- Specialty chemicals / cleaning / sterilization (SteriCube-adjacent)

**Psychographic:** Self-reliant reps who pay for their own tools, care about performance, and expense $29/mo easily.

**Where they hang out:**
- r/sales, r/meddic, LinkedIn "Territory Manager" groups
- Sales Hacker Slack
- #field-sales hashtags on LinkedIn

---

## 🚀 Go-to-Market

### Phase 1: Warm Launch (Week 1–2)
- Post to r/sales: "Built a tool for field reps — roast it"
- LinkedIn post from personal account: "I built the app I wish I had as a territory manager"
- Direct outreach to 50 territory managers on LinkedIn (free tier)

### Phase 2: Content Flywheel (Month 1–3)
- 3 LinkedIn posts/week: "Field rep tip of the day"
- YouTube Shorts: "How I plan my sales day in 5 minutes"
- SEO: Target "territory manager app," "field sales route planner," "sales rep daily planning"

### Phase 3: Channel Partners (Month 3+)
- Reach out to sales training companies (Grant Cardone, MEDDIC Academy)
- Affiliate program: $15/referral for sales coaches
- Integration with Salesforce AppExchange (huge distribution)

---

## 🏗️ Technical Architecture

```
Frontend: React (mobile-first PWA)
Backend: Node.js + Express
Database: Supabase (Postgres)
Auth: Supabase Auth
AI: OpenAI GPT-4o-mini (cheap, fast briefings)
Maps: Google Maps API (Directions + geocoding)
Route optimization: Google OR-Tools or custom TSP (nearest-neighbor heuristic)
Email: Resend.com ($0 for first 3k/mo)
Payments: Stripe Subscriptions
Hosting: Railway.app (~$5/mo)
```

**Total infra cost at 200 users: ~$50/mo** — 99% margin

---

## 📦 MVP Scope (Built Tonight)

- [x] Landing page (index.html)
- [x] Account import (CSV parser)
- [x] Route optimizer (nearest-neighbor TSP)
- [x] AI briefing generator (OpenAI API)
- [x] Stripe payment integration (plan)
- [ ] Mobile PWA (v2)
- [ ] Voice logging (v2)

---

## 🏆 Competitive Moat

1. **Price**: 5x cheaper than SPOTIO for a solo rep
2. **Focus**: We do one thing perfectly — daily briefing + routing
3. **AI briefings**: Nobody else auto-generates walk-in prep cards
4. **Simplicity**: No IT, no training, works on day 1

---

## 💼 Exit Potential

- MicroAcquire at $50K MRR → 3–5x ARR = **$1.8–$3M sale**
- Acqui-hire by SPOTIO, Salesforce, or HubSpot
- Roll into a sales tech portfolio

---

*Built in one night. Designed to make money.*
