# PROJECT_EXPLAINED.md — The Complete Guide to This Repo

This document explains **everything** in this repository: what the project is, how each file works, every concept behind the code (backend, frontend, and research paper), and a mapping of the **DAV (Data Analytics & Visualization) concepts** used throughout.

> **Repo:** **DAV** — an Invoice / Receipt Spend Analyzer: a full analytics pipeline (ingest → clean → analyse → visualise → explain) plus an IEEE-style research paper on one design decision inside that pipeline: *when does hiding the vendor name help or hurt LLM expense categorization?*

---

## Table of Contents

1. [The One-Paragraph Explanation](#1-the-one-paragraph-explanation)
2. [Big-Picture Architecture](#2-big-picture-architecture)
3. [Repository Map](#3-repository-map)
4. [Backend Deep Dive (`backend/`)](#4-backend-deep-dive-backend)
5. [The Document AI Processor Fix](#5-the-document-ai-processor-fix)
6. [Frontend (`frontend/`)](#6-frontend-frontend)
7. [Research & the Paper (`research/`)](#7-research--the-paper-research)
8. [Every Concept, Defined in Context](#8-every-concept-defined-in-context)
9. [DAV Concepts Used in This Project](#9-dav-concepts-used-in-this-project)
10. [End-to-End Data Flow](#10-end-to-end-data-flow)
11. [How to Run Everything](#11-how-to-run-everything)
12. [Gotchas, Stale Code & Trivia](#12-gotchas-stale-code--trivia)

---

## 1. The One-Paragraph Explanation

Accounts-payable teams receive hundreds of invoices and need to know: *how much did we spend, on what, when, from whom — and is anything wrong (duplicates, inflated bills, policy gaming)?* Doing that by hand is slow and error-prone. This project is a **full-stack spend analytics dashboard** that:

1. Accepts uploaded invoice/receipt images or PDFs,
2. Extracts structured fields from them (vendor, amount, date, line items…),
3. Cleans the messy real-world data (European decimals, currency symbols, bare numbers),
4. Categorises every invoice into a spend taxonomy (Food & Dining, Travel, …),
5. Flags **duplicates** (exact + fuzzy) and **anomalies** (statistical outliers),
6. Explains every decision (Explainable AI — "why was this flagged?"),
7. Renders it all as an interactive dashboard (KPIs, charts, tables, drill-downs), and
8. Backs it with a research paper that empirically tests one design decision of that pipeline (vendor masking).

The stack is **React (frontend) + Flask (backend) + Google Document AI + Gemini 3.5 Flash-Lite + SQLite**.

---

## 2. Big-Picture Architecture

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         REACT FRONTEND                               │
│  (Vite build → frontend/dist)                                        │
│  KPI cards · 6 charts · filter bar · invoice table · XAI cards       │
│  calls: http://localhost:5000/api                                    │
└───────────────────────────────▲──────────────────────────────────────┘
                                │ JSON (/api/data, /api/upload …)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  FLASK BACKEND  (backend/app.py, :5000)              │
│                                                                      │
│  ┌──────────────┐   ┌───────────────┐   ┌─────────────────────────┐  │
│  │ Document AI  │   │ Data cleaning │   │ Audit layer             │  │
│  │ Invoice      │──▶│ decimals,     │──▶│ exact + fuzzy duplicates│  │
│  │ Parser       │   │ currency,     │   │ 2.5× vendor-mean anomaly│  │
│  │ (or demo)    │   │ dates, items  │   │ XAI explanations        │  │
│  └──────────────┘   └───────────────┘   └────────────┬────────────┘  │
│         │                     │                      │               │
│         │            ┌────────▼────────┐             │               │
│         │            │ Gemini 3.5      │             │               │
│         │            │ Flash-Lite      │             │               │
│         │            │ (items only,    │             │               │
│         │            │  vendor masked) │             │               │
│         │            └─────────────────┘             │               │
│         ▼                                            ▼               │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                SQLite  backend/data/invoices.db              │    │
│  │        invoices table  +  pattern_insights table             │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
          ┌────────────────────────────────────────────┐
          │  research/ (offline laboratory)            │
          │  CAE-Bench · SROIE · simulations           │
          │  → IEEE paper "Masking the Merchant"       │
          └────────────────────────────────────────────┘
```

---

## 3. Repository Map

```text
DAV/
├── backend/              ← Flask API + full analytics pipeline
│   ├── app.py            ← main API (upload→extract→audit→store→dashboard payload)
│   ├── extract.py        ← standalone CLI: parse invoices → extracted_invoices.csv
│   ├── process.py        ← standalone CLI: clean + categorise + dedup → processed_invoices.csv
│   ├── xai.py            ← standalone CLI: Gemini explanations → processed_with_xai.csv
│   ├── backfill.py       ← one-shot DB migration script (⚠ stale, see §12)
│   ├── requirements.txt  ← flask, documentai, genai, pandas …
│   ├── .env.example      ← template for GCP + Gemini keys
│   └── data/
│       ├── invoices/     ← uploaded files land here
│       └── invoices.db   ← SQLite database
│
├── frontend/             ← React 18 + Vite dashboard (served by Flask)
│   ├── src/App.jsx       ← entire dashboard (~1,000 lines, 6 sections)
│   ├── src/index.css     ← dark theme styling
│   ├── vite.config.js    ← dev server + /api proxy to :5000
│   └── dist/             ← production build that Flask serves at "/"
│
├── research/             ← experiments + IEEE manuscript
│   ├── README.md         ← reproducibility notes (what is real vs simulated)
│   ├── experiments/      ← benchmarks, simulations, table/figure builders
│   ├── data/             ← CAE-Bench CSVs, SROIE/CORD receipt images
│   ├── results/          ← raw API call logs (jsonl), predictions, summaries, stats
│   ├── tables/ figures/  ← LaTeX table fragments + paper figures
│   └── paper/            ← main.tex, paper_draft.md, references.bib, compiled PDF
│
├── .env                  ← real credentials (never commit this)
├── primeval-jet-…json    ← GCP service-account key (should not be in git!)
├── README.md             ← quick-start readme
└── PROJECT_EXPLAINED.md  ← this document
```

---

## 4. Backend Deep Dive (`backend/`)

### 4.1 `app.py` — the monolith that does everything (≈1,180 lines)

This single file is: HTTP server, database layer, data cleaner, ML caller, dashboard-data transformer.

**Database layer.** SQLite (`backend/data/invoices.db`), two tables:

- `invoices` — 17 columns: `source_file, vendor, customer, amount, net_amount, tax_amount, currency, date, invoice_id, category, is_duplicate, duplicate_reason, is_anomaly, xai_explanation, confidence, raw_text, line_items` (+ `created_at`).
- `pattern_insights` — JSON blobs of macro insights, newest first.

`init_db()` runs at import time and even does a tiny **schema migration**: it reads `PRAGMA table_info(invoices)` and `ALTER TABLE ... ADD COLUMN` for columns that older databases lack (`customer`, `net_amount`, `tax_amount`, `confidence`). This is a mini migration system so an existing DB keeps working when the code evolves.

**API endpoints.**

| Method | Endpoint | What it does |
|---|---|---|
| GET  | `/api/invoices` | Raw invoice rows, newest date first |
| GET  | `/api/data` | **The big one**: KPIs + 6 chart datasets + per-question section summaries + XAI insight cards + filter dropdown options |
| GET  | `/api/pattern` | Latest macro pattern insights (as text) |
| POST | `/api/upload` | Receives files, saves to `data/invoices/`, runs the whole pipeline, regenerates pattern insights |
| POST | `/api/demo-data` | Seeds 30 hand-crafted invoices including 2 planted duplicates and 2 planted anomalies |
| POST | `/api/clear` | Empties both tables |
| GET  | `/` and `/<path>` | Serves `frontend/dist` (single-page app routing — unknown paths fall back to `index.html`) |

**The upload pipeline (`run_pipeline_on_files`).** Stage by stage:

1. **Extraction.** If `DOCUMENT_AI_PROJECT_ID` + `DOCUMENT_AI_PROCESSOR_ID` are set → real Google Document AI calls:
   - Uses `resolve_invoice_processor()` (imported from `extract.py`) which **verifies the configured processor really is an Invoice Parser** — a stale Form Parser ID in `.env` can't silently produce empty invoices; it falls back to discovering one. See §5 for the fix that makes this check work on the current SDK.
   - Maps Document AI entity types (`supplier_name`, `invoice_date`, `total_amount`, `total_tax_amount`, `receiver_name`, …) onto the column names via `FIELD_MAP`.
   - Averages **entity confidences** into a per-invoice `confidence` score.
   - Also scans Form-Parser `form_fields` as a second chance to fill vendor/customer/amount when the Invoice Parser returns nothing.
   - Without credentials → **demo fallback**: random synthetic invoices (with a fake `raw_text`) so the whole stack keeps working.

2. **Cleaning.**
   - `clean_amount`: `"194,82"` → `194.82` (European decimal), strips spaces/symbols/anything non-numeric.
   - Fallback logic: if `amount` missing but `net_amount` present → use it; if `tax` missing → `0.0` (never *invent* a tax rate); if `net` missing → `amount − tax`.
   - Currency normalised: uppercase, `"$"` → `"USD"`.
   - Dates coerced via `pd.to_datetime`, invalid → today's date.
   - Customer extracted from raw text with a regex over `Client|Customer|Billed To|Bill To|Sold To`.

3. **Line-item parsing (`parse_structured_line_items`).** Two patterns:
   - **Pattern A (numbered tables):** splits the ITEMS→SUMMARY section on `\n1.` `\n2.` … blocks; inside each block, bare numeric lines become `qty / unit_price / line_total` in order, non-numeric lines accumulate into the description, and header words (`each`, `pcs`, `vat [%]`, `net worth`…) are skipped. Multi-line descriptions get grouped.
   - **Pattern B (fallback):** filters noise lines, keeps up to 6 description-like lines, and *estimates* unit price as `total ÷ count` (clearly marked estimation — quantities are set to 1).
   - Each item also gets a keyword category at item level.

4. **Categorisation (`categorise_with_gemini`) — the vendor-masking condition.**
   - Rule layer first: a curated keyword dictionary (e.g. `"latte"` → Food & Dining, `"toner"` → Office Supplies). If rules produce something other than "Other", that wins (high precision, zero cost).
   - Otherwise **Gemini** is called with a prompt that *deliberately excludes the vendor name* and lists purchased items + amount only: *"Base the category strictly on the items purchased, NOT the vendor or brand."* This is the exact intervention the research paper studies (see §7).
   - Model: `gemini-3.5-flash-lite` (configurable via `GEMINI_MODEL`), response parsed leniently (fuzzy match back into the 8 valid categories), silent fallback to keyword rules on API failure.

5. **Audit layer.**
   - **Exact duplicates:** key = `(lowercased vendor, amount rounded to 2dp, date)`. Both the copy *and* the original get flagged, with human-readable reasons citing each other's invoice IDs.
   - **Anomalies:** an invoice whose `amount` is **> 2.5× the vendor's average** (computed over the combined DB + this batch) is flagged with a ratio explanation ("$520.00 is 108.3× higher than vendor average ($4.80)").
   - **XAI strings prioritised:** duplicate reason > anomaly reason > default "categorised from items, vendor excluded".

**Dashboard computation (`api_data`).** This is the "analytics" half:

- **KPIs:** total spend, bill count, average bill, total tax — each with a **period delta** (first half of the invoice list vs second half, % change) and a **7-point sparkline** (the timestamp range bucketed into 7 equal steps). Plus duplicate count/amount, anomaly count/amount, average Document AI confidence, and a data-quality counter (`missing_fields_count`).
- **6 chart payloads:**
  1. `monthly_trend` — per-month totals + tax + count + a "target" reference line (avg bill × expected count).
  2. `category_share` — donut chart data with % and invoice counts.
  3. `top_vendors` — top-10 vendors by spend.
  4. `category_by_month` — stacked bar data (category × month pivoted).
  5. `anomaly_scatter` — every invoice as a point (date vs amount) carrying flag state + reason.
  6. `amount_distribution` — histogram over 5 fixed buckets (<$50, 50–100, 100–200, 200–500, >$500).
- **Section insights** — one-line answers to the six dashboard questions (how much / when / where / wrong / why / detail), e.g. the `why` line flexes between "impulsive and reactive purchasing" vs "steady budgeted operations" based on deltas/anomaly counts.
- **Insight cards (`generate_pattern_insights`)** — rule-based, math-grounded cards, each with `title / insight / reason / evidence / source_transactions / severity`:
  1. **Spending volatility** — Coefficient of Variation `CV = σ/μ`; if `CV > 1.0` → "impulsive/unbudgeted pattern", else "stable & budgeted". Cites the max & min invoices as evidence.
  2. **Category concentration** — top category's % of all spend + its top vendor.
  3. **Financial leakage** — duplicates + anomalies aggregated in dollars, severity `danger` if any exist, else a clean-audit card.
  4. **Procurement velocity** — bills per month over the observed date span.
- Tolerates both new dict-schema insights and old plain-string rows (a `_insight_to_object` normaliser), so legacy DB data can't crash the dashboard.

### 4.2 `extract.py` — standalone extraction CLI

Run alone (`python backend/extract.py`), it walks `data/invoices/` and writes `data/extracted_invoices.csv`. Notable engineering:

- **`resolve_invoice_processor`** — defensive config: only trusts `DOCUMENT_AI_PROCESSOR_ID` if that processor's type is literally `INVOICE_PROCESSOR`, otherwise lists the project's processors and picks a real Invoice Parser, printing a warning when the configured one is wrong. Fails loudly (listing what *was* found) if there is none. See §5.
- Captures per-entity confidence columns (`amount_confidence`, …) and **`line_item` entities with their properties**.
- **`amount_source`** provenance: `total_amount` vs `net_amount_fallback` — keeps receipts that only expose a net amount instead of dropping them.
- **Demo mode guard:** demo fallback is gated by `ALLOW_DEMO_FALLBACK` (default on). When synthetic data is written, a `data/DEMO_DATA_WARNING.txt` marker is dropped and a loud warning prints — because the paper's discipline is "never report simulated numbers as measured ones."

### 4.3 `process.py` — standalone cleaning/categorisation CLI

Reads the extraction CSV, writes `processed_invoices.csv`:

- The same cleaning rules (European decimals, `"$"`/`"US$"`/`"NAN"`/`""` → `"USD"`, dates coerced, drop amountless rows).
- `extract_item_descriptions`: regex over the ITEMS→SUMMARY window with a `SKIP_WORDS` blocklist, dedupe preserving order, cap 8 items.
- `line_items_from_row`: prefers Document AI structured `line_item` entities over raw-text regex when available.
- `categorise_with_gemini` with `temperature=0` for determinism; explicit "Amazon selling paper = Office Supplies; Amazon selling groceries = Food & Dining" instruction in the prompt.
- **Duplicate detection, two stages:**
  1. *Exact*: `duplicated()` on `vendor|amount|date` key — **both** rows flagged (`keep=False`).
  2. *Fuzzy*: O(n²) pairwise scan — amounts within $0.01, dates ≤ 2 days apart, and vendor-name similarity `SequenceMatcher(...).ratio() ≥ 0.85`.
- Handles Windows file-locks (`PermissionError` → writes a `*_backup.csv`).

### 4.4 `xai.py` — standalone explanation CLI

Reads processed CSV → writes `processed_with_xai.csv` + `pattern_insights.txt`:

- Per-row explanations via Gemini (**note: this CLI pins `gemini-1.5-flash`, older than `app.py`'s `3.5-flash-lite`**):
  - `explain_duplicate` — "Flagged because…", ≤ 25 words.
  - `explain_anomaly` — includes the vendor's average for grounded comparison.
  - `explain_category` — explains from purchased items, explicitly *not* vendor.
  - Every LLM call has a deterministic fallback string so the pipeline never breaks offline.
- Its own anomaly rule differs from `app.py`: here it's `amount_ratio = amount / vendor_mean > 3.0` (`vendor_avg` computed with pandas `groupby(...).transform("mean")`).
- `explain_pattern` — feeds the aggregate summary (total, top category, top vendor, CV, bills/month) into a prompt asking for 3–4 behavioural insights, with a rule-based fallback (impulsive vs consistent buyer classification at CV > 1.0).

### 4.5 `backfill.py` — one-shot migration (⚠ currently broken)

Intended to re-categorise existing DB rows with the newer line-item parser. It imports `parse_line_items` and calls `categorise_with_gemini(..., vendor=...)` — **symbols that no longer exist in `app.py`** (they were renamed to `parse_structured_line_items` and the vendor parameter was removed on purpose for the vendor-masking condition). Run as-is it fails with an ImportError. See §12.

---

## 5. The Document AI Processor Fix

### The symptom

Uploading an invoice crashed with a processor-type error (`AttributeError: type object 'Processor' has no attribute 'Type'` — surfaced as "processor type not found").

### The two root causes

1. **SDK API drift.** `backend/extract.py` used:

   ```python
   invoice_type = documentai.Processor.Type.INVOICE_PROCESSOR
   invoice = [p for p in processors if p.type_ == invoice_type]
   ```

   The installed `google-cloud-documentai` **3.14.0** no longer exposes `Processor.Type`; `processor.type_` is already a plain string like `"INVOICE_PROCESSOR"`. Calling the old enum raises `AttributeError` before any comparison happens.

2. **Wrong processor configured.** `.env` pointed at `6b9a9b0475d771bf` — display name **"DAV Form"**, type **`FORM_PARSER_PROCESSOR`** — while the project's real Invoice Parser is `8683bf802c3ed0b3` ("Dav", type `INVOICE_PROCESSOR`). A Form Parser does not return invoice entities, so even without the crash the extraction would have produced empty fields.

### The fix

`resolve_invoice_processor` now normalises the type through a version-safe helper:

```python
INVOICE_PROCESSOR_TYPE = "INVOICE_PROCESSOR"

def _processor_type_name(processor):
    ptype = getattr(processor, "type_", "")
    return str(getattr(ptype, "name", ptype)).upper()
```

- Works with SDK 3.x strings *and* older enum values (`Enum.name` → `"INVOICE_PROCESSOR"`).
- If the configured processor is not an Invoice Parser, it now prints a clear warning (`"…is a FORM_PARSER_PROCESSOR, not an Invoice Parser; selecting an Invoice Parser instead."`) and auto-selects the real one.
- If none exists, the error lists every processor found and its type, so misconfiguration is obvious.
- `.env` was updated to `DOCUMENT_AI_PROCESSOR_ID=8683bf802c3ed0b3` so it resolves directly.

### Verified

End-to-end call against the real project with `backend/data/invoices/batch1-0930.jpg`:

```text
RESOLVED: 8683bf802c3ed0b3
TEXT CHARS: 665
invoice_id        = 74825616          (conf 0.978)
invoice_date      = 11/10/2011        (conf 0.973)
total_tax_amount  = 42,83             (conf 0.947)
total_amount      = 471,15            (conf 0.936)
net_amount        = 428,32            (conf 0.869)
currency          = $                 (conf 0.622)
supplier_name     = White, Roy and Mcdaniel
line_item         = 3,00 each 100,00 330,00 Nike SB Dunk High …
```

The European decimals (`471,15`) are then normalised to `471.15` by `clean_amount` in `app.py` — the pipeline handles exactly the format this receipt uses.

---

## 6. Frontend (`frontend/`)

### 6.1 Stack & setup

- **React 18** (`main.jsx`: `createRoot(...)` + `StrictMode`), **Vite** as bundler/dev server, **Recharts** for all charts, **lucide-react** for iconography, custom dark-theme CSS (`index.css`, ~900 lines).
- `vite.config.js`: dev server on `:5173` with a **proxy** — `/api/*` is forwarded to `http://localhost:5000`, so dev mode looks seamless; in production the built `dist/` is served by Flask itself (no CORS issue in prod; `flask-cors` covers the dev cross-origin case).
- `npm run build` → `frontend/dist` → Flask serves it at `/` with an SPA fallback route (unknown paths return `index.html`).
- Trivia: `package.json` still lists `chart.js`/`react-chartjs-2` (the README was written when the first chart library was Chart.js) but **all current code uses Recharts**.

### 6.2 `App.jsx` — the entire dashboard (≈1,030 lines)

**State.** `data` (server payload), loading/uploading/seeding/clearing flags, toast `flash`, `expandedRows` (Set of expanded table rows), plus a full **global filter state**: category, vendor, customer, flag state (`ALL / NORMAL / DUPLICATE / ANOMALY / FLAGGED`), text search, date range; `activeKpi` (clicking a KPI card cross-filters the dashboard).

**Semantic colour system.** Colours carry meaning consistently: royal blue = normal spend, red = duplicates, amber/orange = anomalies, green = clean/pass, slate = muted/secondary. A category palette cycles the 8 spend categories in every categorical chart.

**Reusable widgets.** `MiniSparkline` (borderless LineChart inside a KPI card) and `AnalyticalKpiCard` (title, value, delta pill with arrow icon — direction of risk automatically inverted for risk metrics like anomaly count! — and sparkline).

**Layout — the six analytical questions**, each a `<section>`:

1. **HOW MUCH ARE WE SPENDING OVERALL?** — KPI row (total spend, bills, avg bill, tax) + amount-distribution + summary.
2. **WHEN DOES SPENDING OCCUR?** — monthly trend area chart with reference "target" line.
3. **WHERE AND ON WHAT IS MONEY SPENT?** — category donut, top-vendor horizontal bars, category-by-month stacked bars.
4. **RISK FLAGS** — scatter plot (date × amount) where duplicate/anomaly points take the semantic colours; filterable flag table.
5. **AI SPENDING INSIGHTS & EXPLANATIONS (XAI)** — the insight cards (title / insight / reasoning / evidence / cited source invoices / severity chip).
6. **INVOICES & ITEMIZED DETAILS** — searchable, sortable invoice table; clicking a row expands an **audit trail**: full line items (qty, unit price, line total chips), XAI explanation, Document AI confidence, extraction/audit reasons.

---

## 7. Research & the Paper (`research/`)

The research directory is the *experimental laboratory* that de-risks one design decision the production pipeline makes: **the pipeline masks vendor names during LLM categorisation** (the prompt sees items, not brands). Is that actually a good idea? The paper answers with measurements.

**Paper:** *"Masking the Merchant: When Vendor Anonymization Helps and Hurts LLM Expense Categorization"* — IEEEtran conference manuscript (`research/paper/main.tex`, compiled PDF included), markdown mirror in `paper_draft.md`.

### The five studies

| Study | What it does | Status |
|---|---|---|
| **CAE-Bench** (150 items) | 3 cohorts of 50 — *Aligned* (item matches vendor prior), *Conflict* (Amazon sells coffee), *Weak signal* ("Register Sale Transaction Line 1") — × 4 prompt conditions (full / masked / vendor-only / masked+abstain), Gemini at temperature 0, JSON mode | **Real API calls** (logs in `cae_bench_calls.jsonl`) |
| **Opaque stress test** (50) | Item text replaced by `"SKU 3B16"` codes — only the vendor is informative; the boundary case | Real API calls |
| **Singleton abstention** | One item per API call on weak + opaque sets; tests whether "reply Insufficient when unsure" abstention is stable | Real API calls |
| **SROIE extraction** (50 public receipts) | Document AI Invoice Parser vs regex-over-oracle-OCR vs Gemini-VLM on the image; accuracy *and* $ per 1,000 documents | Real calls; note: SROIE may be in VLM pretraining |
| **Anomaly simulation** | 100 seeds × 1,000 synthetic transactions, 5% contamination; simple threshold vs MAD vs Isolation Forest, with PR-AUC and ROC-AUC | **Simulation only** — honestly labelled |

### Headline findings (from the abstract)

- Masking vs full context is a **wash in aggregate** (85.3% vs 84.7%, McNemar *p* = 1.00) — but the aggregate hides **opposing cohort effects**: masking **+6 pts** when the item conflicts with the vendor prior, **−8 pts** when item text is weak, **−64 pts** when opaque.
- **Vendor-only** condition: 0% accuracy on conflict items; the model follows the brand prior on 82% of them. Brand bias is real but *conditional on missing item evidence*.
- **Abstention is batch-sensitive**: 100% abstention on opaque items when called one-at-a-time, but two 25-item batches split into one all-answer and one all-abstention batch — a genuinely wild instability finding.
- Vendor fallback recovers masked-item loss only partially (**72%** vs full context's **88%**).
- Extraction economics: Gemini extracts all three SROIE fields correctly **86%** of the time vs Document AI's **30%**, at **$0.48 vs $100 per 1,000 documents** — the "specialised" component is not the reliable one.
- Anomaly scoring: simple threshold F1 **0.715** ≈ Isolation Forest **0.723** ≈ MAD **0.755**; the earlier draft's ROC-AUC of 0.999 was an artefact of class imbalance.

### Reproducibility engineering (the DAV-style discipline part)

- Every API call is appended to **`*.jsonl` checkpoints** with raw responses, token counts, latency, timestamps → reruns *resume* instead of re-paying; `--evaluate-only` re-scores without calls.
- Bootstrap 95% CIs (10,000 resamples, fixed seed), exact **McNemar tests** on paired predictions, confusion matrices per condition exported as CSVs, LaTeX tables auto-generated by `export_paper_tables.py`, figures by `make_figures.py`.
- `research/README.md` draws an explicit line between **measured** and **simulated**, and the archive directory literally quarantines an earlier draft's fabricated numbers (98.5% F1, 0.999 AUC…) with a README explaining what was wrong with them. Research-integrity scaffolding most student projects never build.

---

## 8. Every Concept, Defined in Context

Here is each concept the codebase leans on, explained briefly:

**Cloud ML / API concepts**
- **Google Document AI (Invoice Parser)** — GCP's managed document-understanding processor: consumes PDF/image bytes, returns `document.text` (full OCR text) + typed `entities` (`supplier_name`, `total_amount`, …) each with a `confidence`.
- **Processor types** — `INVOICE_PROCESSOR` returns invoice fields; `FORM_PARSER_PROCESSOR` returns key/value form fields. They are *not* interchangeable, which is why `resolve_invoice_processor` validates the type.
- **Field mapping (`FIELD_MAP`)** — dictionary translating the parser's taxonomy into our DB schema; the adapter pattern for schema impedance mismatch.
- **Gemini (`google-genai` SDK)** — Google's LLM family. Used here with `temperature=0` (determinism) and constrained reply formats ("reply with ONLY the category name").
- **Prompt engineering / vendor masking** — deliberately withholding the vendor name from the prompt to remove brand priors; the exact intervention the paper stress-tests.
- **Graceful degradation / demo mode** — every cloud dependency has a synthetic fallback (random invoices, keyword rules) so the demo never dies without credentials.

**Data engineering concepts**
- **ETL pipeline** — extract (Document AI) → transform (clean, categorise, audit) → load (SQLite), implemented in `run_pipeline_on_files`.
- **Data cleaning** — European decimals (`194,82`), currency symbol→ISO code, `.title()` casing, `pd.to_datetime` coercion, blank→`USD`.
- **Provenance flags** — `amount_source`, `confidence`, `DEMO_DATA_WARNING.txt` markers recording *where each number came from*.
- **Schema migrations** — `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`, so an older DB gains new columns without being recreated.
- **SQLite** — embedded file DB; `row_factory=sqlite3.Row` for dict-like rows; used as both fact table (invoices) and metadata store (pattern_insights).
- **Deduplication (data quality)** — exact keys *and* fuzzy string matching.
- **Fuzzy matching — `difflib.SequenceMatcher`** — edit-distance-style similarity ratio between two strings; threshold 0.85; combined with temporal (≤2 days) and numeric (≤$0.01) constraints.
- **Idempotent-ish audit** — flags are recomputed over `new ∪ history`, so a new invoice can retroactively implicate an old one.

**Statistics & analytics concepts**
- **Descriptive statistics** — mean, median, standard deviation, percentages, counts.
- **Coefficient of Variation `CV = σ/μ`** — scale-free volatility measure; CV > 1.0 ⇒ "impulsive / spot-buying" profile in the dashboard cards.
- **Median Absolute Deviation (MAD) — modified Z-score** — robust outlier test `M_i = 0.6745(x − median)/MAD > 3.0`; used in the research anomaly simulation because it doesn't get dragged by the very outliers it hunts.
- **Counterfactual explanation** — "you would have passed at $65.34": explanation *as a boundary in data space* (research/audit framing).
- **Period-over-period deltas & cohort analysis** — first half vs second half of records; aligned/conflict/weak/opaque cohorts in the paper.
- **Split-purchase & policy-leakage analytics** — behavioural pattern analytics over approval limits (splitting invoices to stay under thresholds) and time-of-purchase policy; studied as macro-pattern ideas in the paper/README lineage.

**Machine learning / NLP concepts (mostly in the research layer)**
- **TF-IDF** — bag-of-words weighted by inverse document frequency; `sublinear_tf`, 1–2 **n-grams**; used as the CAE-Bench baseline in `run_cae_bench.py`.
- **Logistic Regression** — linear classifier over TF-IDF features; the baseline the LLM is compared against.
- **XAI (Explainable AI)** — two families in this repo:
  - *Post-hoc prose* (production backend: Gemini writes human sentences),
  - *Counterfactuals / statistical attribution* (MAD thresholds, feature contributions in research).
- **Model evaluation** — cross-validation, McNemar tests, bootstrap CIs, confusion matrices, PR/ROC-AUC in `research/experiments/`.
- **Data augmentation / simulation** — synthetic demo invoices and 100-seed anomaly simulation.

**Software engineering concepts**
- **Flask** — routing, `request.files`, `jsonify`, `send_from_directory` SPA fallback, static-folder serving, `flask-cors`.
- **Environment-based configuration** — `.env` loaded by `python-dotenv`; secrets never hard-coded.
- **Standalone CLIs as pipeline stages** — `extract.py` → `process.py` → `xai.py` write intermediate CSVs so you can inspect each stage independently.
- **Defensive configuration** — `resolve_invoice_processor` refuses to trust a mis-typed processor ID and self-heals by discovery.
- **Reproducibility tooling** — jsonl checkpoints, fixed seeds/temperature, bootstrap + McNemar statistics, quarantined legacy results.

**Frontend concepts**
- **React state/hooks** — `useState`, `useMemo` (recompute filtered data only when deps change), `useRef` (file input), `useEffect` (initial fetch).
- **Derived data / unidirectional flow** — server payload → client-side filtering/pivoting → charts; server never re-consulted on filter changes.
- **Data-visualisation selection** — area (trend), donut (composition), bars (ranking), stacked bars (composition-over-time), scatter (flag geography in amount×time space), histogram (distribution), sparklines (context inside KPIs). Colour = semantics.
- **Dashboard UX patterns** — filter bar, drill-down rows, cross-filtering by KPI click, toast feedback, empty states, severity chips.

---

## 9. DAV Concepts Used in This Project

*(DAV = Data Analytics & Visualization. This section maps the classic DAV-curriculum concepts to the exact files/functions where they appear.)*

| DAV concept | Where it's used in this repo | Concrete example |
|---|---|---|
| **Data collection / ingestion** | `POST /api/upload`, Document AI calls | Receipt JPGs → `data/invoices/` → parsed entities |
| **Data cleaning / preprocessing** | `clean_amount`, `clean_date`, `clean_vendor`, currency mapping | `"194,82"` → `194.82`; `"$"` → `USD` |
| **Data transformation / parsing** | regex line-item parsers (Pattern A/B), `FIELD_MAP` | Numbered invoice tables → structured `{description, qty, unit_price, line_total}` |
| **ETL pipeline** | `run_pipeline_on_files` | Extract → transform → load into SQLite |
| **Data storage & retrieval** | SQLite schemas, SQL aggregations | `SELECT * FROM invoices ORDER BY date ASC` feeding analytics |
| **Missing-data handling** | amount→net fallback, `tax = 0` policy, `missing_fields_count` KPI | "Never invent a tax rate" comment |
| **Deduplication / redundancy detection** | `flag_duplicates` logic in `app.py`, `dup_key_exact` in `process.py` | Uber double-billing caught across two name variants |
| **Descriptive statistics** | `generate_pattern_insights`, `api_data` KPIs | Mean, σ, median, counts, % shares |
| **Measures of dispersion — CV** | volatility cards | `CV = σ/μ > 1 ⇒ impulsive buyer` |
| **Outlier / anomaly detection** | 2.5× vendor-average rule in `app.py`; MAD simulation in research | $520 coffee-machine charge vs $4.80 Starbucks average |
| **Robust statistics** | MAD vs mean/σ in `research/experiments/run_anomaly_simulation.py` | One outlier can't inflate the median |
| **Time-series / trend analysis** | monthly trend chart, procurement cadence | Spend per month with target reference line |
| **Aggregation & group-by pivots** | pandas `groupby`, chart map-reduce code | Category×month pivot for stacked bars |
| **Exploratory Data Analysis (EDA)** | the whole dashboard + insight cards; research summaries | "Top category = X% of spend, top vendor = Y" |
| **Segmentation / cohort analysis** | CAE-Bench aligned/conflict/weak/opaque cohorts | Masking helps conflict cohort, hurts weak cohort |
| **Classification (supervised ML)** | Gemini categorisation; TF-IDF + LogReg baseline in research | 8-category spend taxonomy |
| **Feature engineering & vectorisation** | TF-IDF baseline, 1–2 n-grams | `"car rental"` as one bi-gram feature |
| **Model evaluation** | McNemar tests, bootstrap CIs, confusion matrices, PR/ROC-AUC | `research/results/confusion_*.csv`, `cae_bench_tests.csv` |
| **Explainability / interpretability** | XAI cards, per-invoice reasons, counterfactuals | "Categorised as Food & Dining strictly on item 'Caffe Latte'" |
| **Data visualisation** | the six charts + KPI sparklines | Area, donut, horizontal bar, stacked bar, scatter, histogram |
| **Visual encoding & colour semantics** | global palette constants | red = duplicate, amber = anomaly, blue = spend, green = clean |
| **Dashboard / BI design** | `App.jsx` six-question layout, filter bar, drill-downs | KPI click cross-filters charts |
| **Data storytelling** | `section_insights`, evidence + source citations | Insight card cites the invoices it derived from |
| **Business analytics (fraud/audit patterns)** | duplicate/anomaly rules; macro-pattern analysis in the research | Duplicate double-payments, vendor-mean outliers |
| **Data simulation & sampling** | demo datasets, 100-seed anomaly simulation | Fixed seeds 0–99, 5% contamination |
| **Reproducibility & provenance** | jsonl call logs, seeds, quarantine archive, warning markers | `DEMO_DATA_WARNING.txt` on synthetic extractions |
| **Privacy / data confidentiality** | demo fallback keeps the app usable without sending documents anywhere | UI development without GCP credentials |

Quick glossary of the acronyms that keep appearing:

- **KPI** — key performance indicator (here: total spend, avg bill, tax, flag counts).
- **XAI** — explainable AI; making a model's decision human-auditable.
- **MAD** — median absolute deviation, a robust scale estimator.
- **CV** — coefficient of variation, `σ/μ`.
- **TF-IDF** — term frequency × inverse document frequency text vectorisation.
- **ETL** — extract, transform, load.
- **PR-AUC / ROC-AUC** — area under precision-recall / ROC curve; PR curves are the honest metric for rare-event data like anomalies.

---

## 10. End-to-End Data Flow

**Upload path:**

```text
user picks files
   → Flask saves them (secure_filename) into backend/data/invoices/
   → Document AI Invoice Parser  (or demo synth w/o creds)
        ├─ raw_text  (full OCR)
        ├─ entities  → vendor, date, amount, tax, subtotal, customer, currency…
        └─ entity confidences → mean → `confidence`
   → cleaning            European decimals, currency→ISO, ISO dates
   → line-item parsing   numbered tables → {desc, qty, unit, total}
   → categorisation      keyword rules ⭢ Gemini (items only!) ⭢ rules fallback
   → audit               exact dup keys; amount > 2.5× vendor mean
   → SQLite INSERT       row + xai_explanation + line_items JSON
   → generate_pattern_insights()  → 4 grounded cards → pattern_insights table
   → frontend refetches /api/data → KPIs + charts + insight cards re-render
```

**Dashboard request path:**

```text
GET /api/data
   → SELECT all invoices (chronological) + latest pattern insights
   → KPIs + deltas + sparklines
   → monthly / category / vendor / stacked / scatter / histogram payloads
   → section summaries + insight cards + filter options
   → one JSON response → React useMemo filters → Recharts render
```

**Research path:**

```text
hypothesis (does masking hurt?) → build 150-item benchmark × 4 conditions
   → Gemini calls logged to jsonl checkpoints (resume-safe)
   → scoring: accuracy, McNemar, bootstrap CI, confusion matrices
   → export_paper_tables.py → tables/*.tex, make_figures.py → figures/
   → main.tex/paper_draft.md → compiled IEEE PDF
   → conclusion feeds back into backend prompt design (mask, but keep fallback)
```

---

## 11. How to Run Everything

**Backend**

```bash
cd backend
pip install -r requirements.txt
python app.py                      # http://localhost:5000
```

Configure `.env` (copy from `.env.example`): `GOOGLE_APPLICATION_CREDENTIALS`, `DOCUMENT_AI_*`, `GEMINI_API_KEY`. Without the Document AI vars it still runs fully in demo mode (synthetic extraction) — good for UI development. The processor ID must belong to an **Invoice Parser**; the resolver auto-corrects a mis-typed ID (see §5).

**Frontend**

```bash
cd frontend
npm install
npm run dev         # hot reload, :5173, proxies /api → :5000
npm run build       # dist/ — served automatically by Flask
```

**Research experiments** — see `research/README.md` §"Reproducing the studies": e.g.

```bash
python research/experiments/run_cae_bench.py --models gemini-3.5-flash-lite
python research/experiments/run_extraction_benchmark.py --limit 50 --docai --vlm gemini-3.5-flash-lite
python research/experiments/export_paper_tables.py
python research/experiments/make_figures.py
```

**Demo buttons to press once running:** *Load demo data* (30 invoices with planted dups/anomalies), *+ Add Invoice* to upload real images.

---

## 12. Gotchas, Stale Code & Trivia

1. **`backend/backfill.py` is broken** — imports `parse_line_items` and old `categorise_with_gemini(vendor=…)` signature that were renamed/removed when vendor masking was introduced. Running it throws an ImportError. If you need it, update it to `parse_structured_line_items` and the new signature.
2. **`xai.py` pins `gemini-1.5-flash`** while `app.py` uses `gemini-3.5-flash-lite` — the standalone CLI predates the model upgrade. Its anomaly rule (3.0× mean) also differs from `app.py`'s (2.5× mean).
3. **README vs reality** — root README says "Chart.js"; actual charts are Recharts (chart.js remains an unused `package.json` dependency).
4. **`primeval-jet-…json`** (GCP service-account key) and the real `.env` sit at repo root and the repo is initialised in git — these should be in `.gitignore` and rotated if ever pushed. The key file's own name suggests it was GCP-generated.
5. **Dataset** — the source invoice images come from a public Kaggle OCR dataset (linked in README.md); `backend/data/invoices/` holds a couple for manual testing, and full SROIE/CORD test sets live under `research/data/`.
6. **No commits yet** — the repo is a fresh `git init`; nothing is committed, so today the only history is this working tree.
7. **Document AI processor** — the project's invoice parser lives in `asia-south1`; if you create a new one, either update `DOCUMENT_AI_PROCESSOR_ID` or let `resolve_invoice_processor` discover it. A Form Parser ID will now produce a warning, not a crash.
