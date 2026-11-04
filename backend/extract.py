"""
extract.py
Extract invoice fields using Google Document AI Invoice Parser.
If Document AI credentials are not set, runs in DEMO mode and generates
sample invoice data so the rest of the pipeline works immediately.

Outputs: data/extracted_invoices.csv
"""
import os
import csv
import random
from pathlib import Path
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

PROJECT_ID = os.getenv("DOCUMENT_AI_PROJECT_ID")
LOCATION = os.getenv("DOCUMENT_AI_LOCATION", "us")
PROCESSOR_ID = os.getenv("DOCUMENT_AI_PROCESSOR_ID")
CREDENTIALS_PATH = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")

INPUT_FOLDER = Path("data/invoices")
OUTPUT_CSV = Path("data/extracted_invoices.csv")

# ---------------------------------------------------------------------------
# DEMO MODE: sample vendors / amounts / dates so the pipeline runs end-to-end
# ---------------------------------------------------------------------------
DEMO_VENDORS = [
    "Starbucks Coffee", "Amazon.com", "Uber", "Shell Gas Station",
    "Hilton Hotel", "Adobe Software", "Walmart Supermarket",
    "McDonald's", "Delta Airlines", "Verizon Phone",
    "CVS Pharmacy", "Office Depot", "Spotify", "Shell Gas Station",
    "Starbucks Coffee", "Amazon.com",
]
DEMO_AMOUNTS = [4.50, 89.99, 15.30, 45.00, 199.00, 19.99, 62.00, 12.50, 340.00, 75.00, 24.99, 35.00, 11.99]
DEMO_CATEGORIES = {
    "Starbucks Coffee": "Food & Dining",
    "Amazon.com": "Office Supplies",
    "Uber": "Travel",
    "Shell Gas Station": "Transportation",
    "Hilton Hotel": "Travel",
    "Adobe Software": "Software & Subscriptions",
    "Walmart Supermarket": "Food & Dining",
    "McDonald's": "Food & Dining",
    "Delta Airlines": "Travel",
    "Verizon Phone": "Utilities",
    "CVS Pharmacy": "Healthcare",
    "Office Depot": "Office Supplies",
    "Spotify": "Software & Subscriptions",
}


def run_demo_extraction():
    """Generate sample invoice records so the pipeline can run without GCP."""
    rows = []
    base_date = datetime(2026, 1, 1)
    for i in range(30):
        vendor = random.choice(DEMO_VENDORS)
        amount = random.choice(DEMO_AMOUNTS)
        date = base_date + timedelta(days=random.randint(0, 89))
        # Inject a couple of exact duplicates
        if i in (5, 6):
            vendor = "Starbucks Coffee"
            amount = 4.50
            date = datetime(2026, 1, 15)
        # Inject an anomaly (large amount for a small vendor)
        if i == 20:
            amount = 500.00
            vendor = "Starbucks Coffee"
        rows.append({
            "source_file": f"demo_invoice_{i+1:03d}.pdf",
            "vendor": vendor,
            "date": date.strftime("%Y-%m-%d"),
            "amount": f"{amount:.2f}",
            "currency": "USD",
            "invoice_id": f"INV-{1000+i}",
            "category": DEMO_CATEGORIES.get(vendor, "Other"),
            "extraction_method": "DEMO (no Document AI)",
        })

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = sorted(rows[0].keys())
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"DEMO MODE: Generated {len(rows)} sample invoices -> {OUTPUT_CSV}")
    print("Note: Set Document AI env vars in .env to use real extraction instead.")
    return rows


INVOICE_PROCESSOR_TYPE = "INVOICE_PROCESSOR"


def _processor_type_name(processor):
    """Return a processor's type as a plain string.

    google-cloud-documentai 3.x stores ``type_`` as a string such as
    ``"INVOICE_PROCESSOR"``; older releases exposed a ``Processor.Type``
    enum. Calling ``documentai.Processor.Type`` on 3.x raises
    ``AttributeError`` ("processor type not found"), so normalise both.
    """
    ptype = getattr(processor, "type_", "")
    return str(getattr(ptype, "name", ptype)).upper()


def resolve_invoice_processor(client, project_id, location, configured_id):
    """Return an Invoice Parser processor ID.

    A configured ID is only accepted if it really is an Invoice Parser.
    Otherwise we discover one in the project, so a stale Form Parser ID in
    .env cannot silently produce empty invoices.
    """
    parent = client.common_location_path(project_id, location)
    processors = list(client.list_processors(request={"parent": parent}))
    invoice = [p for p in processors if _processor_type_name(p) == INVOICE_PROCESSOR_TYPE]

    if configured_id:
        configured = next(
            (p for p in processors if p.name.rsplit("/", 1)[-1] == configured_id),
            None,
        )
        if configured is not None and _processor_type_name(configured) == INVOICE_PROCESSOR_TYPE:
            return configured_id
        if configured is not None:
            print(
                f"WARNING: configured processor '{configured.display_name}' is a "
                f"{_processor_type_name(configured)}, not an Invoice Parser; "
                "selecting an Invoice Parser instead."
            )

    if invoice:
        chosen = invoice[0]
        chosen_id = chosen.name.rsplit("/", 1)[-1]
        print(f"Using Invoice Parser: {chosen.display_name} ({chosen_id})")
        return chosen_id

    found = ", ".join(
        f"{p.display_name} ({_processor_type_name(p)})" for p in processors
    ) or "none"
    raise ValueError(
        "No Document AI Invoice Parser found in this project/location. "
        f"Processors found: {found}. Create an Invoice Parser or set "
        "DOCUMENT_AI_PROCESSOR_ID to an INVOICE_PROCESSOR."
    )


def run_document_ai_extraction():
    """Real extraction using Google Document AI Invoice Parser."""
    from google.cloud import documentai_v1 as documentai
    from google.api_core.client_options import ClientOptions

    if not PROJECT_ID:
        raise ValueError("DOCUMENT_AI_PROJECT_ID not set in .env")

    if CREDENTIALS_PATH:
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = CREDENTIALS_PATH

    opts = ClientOptions(api_endpoint=f"{LOCATION}-documentai.googleapis.com")
    client = documentai.DocumentProcessorServiceClient(client_options=opts)
    processor_id = resolve_invoice_processor(
        client, PROJECT_ID, LOCATION, PROCESSOR_ID
    )
    name = client.processor_path(PROJECT_ID, LOCATION, processor_id)

    FIELD_MAP = {
        "supplier_name": "vendor",
        "invoice_date": "date",
        "total_amount": "amount",
        "currency": "currency",
        "invoice_id": "invoice_id",
        "subtotal": "subtotal",
        "total_tax_amount": "tax_amount",
    }

    INPUT_FOLDER.mkdir(parents=True, exist_ok=True)
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    files = []
    for ext in ["*.pdf", "*.png", "*.jpg", "*.jpeg", "*.tiff", "*.tif"]:
        files.extend(INPUT_FOLDER.glob(ext))

    if not files:
        print(f"No invoice files found in {INPUT_FOLDER}.")
        return

    rows = []
    for f in files:
        print(f"Processing {f.name}...")
        suffix = f.suffix.lower()
        if suffix == ".pdf":
            mime_type = "application/pdf"
        elif suffix in [".png", ".jpg", ".jpeg"]:
            mime_type = f"image/{suffix.lstrip('.').replace('jpg', 'jpeg')}"
        elif suffix in [".tiff", ".tif"]:
            mime_type = "image/tiff"
        else:
            mime_type = "application/pdf"

        with open(f, "rb") as fh:
            image_content = fh.read()

        request = {
            "name": name,
            "raw_document": {"content": image_content, "mime_type": mime_type},
        }
        result = client.process_document(request=request)
        document = result.document

        row = {"source_file": f.name, "raw_text": document.text}
        for entity in document.entities:
            key = FIELD_MAP.get(entity.type_, entity.type_)
            row[key] = entity.mention_text
            row[f"{key}_confidence"] = round(entity.confidence, 3)

        line_items = []
        for entity in document.entities:
            # Document AI uses the singular type name "line_item".
            if entity.type_ == "line_item":
                item = {}
                for prop in entity.properties:
                    pkey = FIELD_MAP.get(prop.type_, prop.type_)
                    item[pkey] = prop.mention_text
                line_items.append(item)
        row["line_items"] = __import__("json").dumps(line_items, ensure_ascii=False)

        # Some receipts expose only net_amount; keep the row instead of dropping it.
        if not row.get("amount") and row.get("net_amount"):
            row["amount"] = row["net_amount"]
            row["amount_source"] = "net_amount_fallback"
        else:
            row["amount_source"] = "total_amount"
        rows.append(row)

    fieldnames = sorted(set().union(*(r.keys() for r in rows)))
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone. Extracted {len(rows)} invoices -> {OUTPUT_CSV}")


def run_extraction():
    has_docai = bool(PROJECT_ID and PROCESSOR_ID)
    if has_docai:
        print("Document AI credentials detected. Attempting real extraction...")
        try:
            run_document_ai_extraction()
            return
        except Exception as e:
            print(f"\nDocument AI failed: {e}")

    allow_demo = os.getenv("ALLOW_DEMO_FALLBACK", "1") != "0"
    if not allow_demo:
        raise SystemExit(
            "Extraction failed and ALLOW_DEMO_FALLBACK=0. Fix Document AI or "
            "enable demo mode explicitly."
        )

    print("\n" + "=" * 70)
    print("WARNING: DEMO MODE — writing synthetic invoices, not real extraction.")
    print("These rows are for UI development only and must not be reported as")
    print("experimental results. Unset ALLOW_DEMO_FALLBACK or fix credentials.")
    print("=" * 70 + "\n")
    marker = Path("data/DEMO_DATA_WARNING.txt")
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(
        "data/extracted_invoices.csv was generated in DEMO mode and contains "
        "synthetic invoices. Do not use it as experimental data.\n",
        encoding="utf-8",
    )
    run_demo_extraction()


if __name__ == "__main__":
    run_extraction()