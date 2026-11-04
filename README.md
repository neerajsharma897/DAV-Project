# Invoice / Receipt Spend Analyzer

**Stack:** React (frontend) + Flask (backend) + Google Document AI + Gemini 3.5 Flash-Lite + SQLite

---

## Quick Start

### 1. Backend (Flask API)

```bash
cd backend
pip install -r requirements.txt
python app.py
```
Runs on **http://localhost:5000**

### 2. Frontend (React)

```bash
cd frontend
npm install
npm run build
cd ..
```
Build output goes to `frontend/dist/`, which Flask serves automatically.

**Development mode** (optional, hot reload):
```bash
cd frontend
npm run dev
```
Vite dev server runs on http://localhost:5173 and proxies `/api` to Flask.

---

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
DOCUMENT_AI_PROJECT_ID=your-gcp-project-id
DOCUMENT_AI_LOCATION=us
DOCUMENT_AI_PROCESSOR_ID=your-processor-id
GEMINI_API_KEY=your-gemini-api-key
```

### Get GCP credentials
1. [Google Cloud Console](https://console.cloud.google.com/) → create project
2. Enable **Document AI API**
3. Create processor → **Invoice Parser**
4. Create Service Account → download JSON key
5. Set `GOOGLE_APPLICATION_CREDENTIALS` to the JSON path

### Get Gemini API key
1. [Google AI Studio](https://aistudio.google.com/) → create API key
2. Add as `GEMINI_API_KEY` in `.env`

### Document AI troubleshooting
- The processor **must be an Invoice Parser** (`INVOICE_PROCESSOR`), not a Form Parser (`FORM_PARSER_PROCESSOR`). The backend verifies the configured ID and automatically selects a real Invoice Parser if the ID is wrong (with a warning).
- If extraction fails with `processor type not found` / `AttributeError: type object 'Processor' has no attribute 'Type'`, update `backend/extract.py`: newer `google-cloud-documentai` SDKs expose `processor.type_` as a plain string. The current code handles both old and new SDK versions.
- List the processors in your project to find the right ID:

```python
from google.cloud import documentai_v1 as d
from google.api_core.client_options import ClientOptions
client = d.DocumentProcessorServiceClient(
    client_options=ClientOptions(api_endpoint="asia-south1-documentai.googleapis.com")
)
for p in client.list_processors(parent="projects/YOUR_PROJECT/locations/asia-south1"):
    print(p.name.rsplit("/", 1)[-1], p.display_name, p.type_)
```

---

## How to Use

1. Open **http://localhost:5000**
2. Click **+ Add Invoice** (top-right)
3. Select one or more PDF/image files
4. Pipeline runs automatically — dashboard updates with results

---

## Project Structure

```
DAV/
├── backend/
│   ├── app.py              # Flask API (upload, data, pattern)
│   ├── extract.py          # Standalone Document AI extraction
│   ├── process.py          # Standalone processing (categorise, dedup)
│   ├── xai.py              # Standalone XAI explanations
│   ├── requirements.txt    # Python deps
│   ├── .env.example        # Config template
│   └── data/
│       ├── invoices/       # Uploaded invoice images
│       └── invoices.db     # SQLite database
├── frontend/
│   ├── package.json        # React 18, Vite, Chart.js
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx         # Dashboard (KPIs, charts, tables, XAI)
│       └── index.css
└── README.md
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data` | KPIs + chart data + flagged invoices + XAI insights |
| GET | `/api/invoices` | All invoices (raw list) |
| GET | `/api/pattern` | Pattern-level XAI insights |
| POST | `/api/upload` | Upload files → runs full pipeline |

---

## Pipeline Stages

1. **Extract** — Document AI Invoice Parser pulls vendor, date, amount, currency, invoice ID
2. **Clean** — European decimals (`194,82` → `194.82`), currency symbols (`$` → `USD`)
3. **Categorise** - Gemini 3.5 Flash-Lite categorises from **line items only**. This is the vendor-masking condition studied in the paper; the paper finds masking is a trade-off and recommends including vendor context. Whether an explicit item-priority instruction helps is untested.
4. **Dedup** — Flags exact duplicates (same vendor + amount + date) and fuzzy matches
5. **Anomaly** — Flags amounts > 2.5x vendor average
6. **XAI** — Gemini generates per-invoice explanations + pattern-level insights

---

## Demo Mode (no GCP)

Leave `DOCUMENT_AI_PROJECT_ID` empty in `.env`. The pipeline runs with sample data so the full frontend still works.

---

## Research Paper and Experiments

The `research/` directory contains the manuscript and the scripts that produce every reported number:

- `research/paper/main.tex` — IEEEtran manuscript, **Masking the Merchant: When Vendor Anonymization Helps and Hurts LLM Expense Categorization**
- `research/paper/paper_draft.md` — Markdown mirror of the manuscript
- `research/README.md` — what is measured vs. simulated, setup, commands, and caveats
- `research/experiments/` — CAE-Bench, opaque stress test, singleton abstention, SROIE extraction, and anomaly simulation

The paper deliberately separates measured results from simulation and does not use the earlier draft's fabricated benchmark numbers.

## Dataset

https://www.kaggle.com/datasets/osamahosamabdellatif/high-quality-invoice-images-for-ocr

Place invoice images in `backend/data/invoices/` or upload directly from the React frontend.