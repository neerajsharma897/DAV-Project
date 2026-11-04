"""
backfill.py — Re-categorise existing DB invoices using improved line item parsing
and backfill xai_explanation for all rows.
Run once after updating app.py:
  python backend/backfill.py
"""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
os.chdir(os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv("../.env")

# Fix GOOGLE_APPLICATION_CREDENTIALS path
from pathlib import Path
_creds = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "")
if _creds and not os.path.isabs(_creds):
    _abs = str(Path("..") / _creds)
    if os.path.exists(_abs):
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = _abs

from app import get_db, parse_structured_line_items, categorise_with_gemini

conn = get_db()
rows = conn.execute("SELECT id, vendor, amount, currency, raw_text, line_items FROM invoices").fetchall()

updates = []
for r in rows:
    row = dict(r)
    amount = row.get("amount") or 0
    line_items = parse_structured_line_items(row.get("raw_text", ""), amount)
    item_descriptions = [item["description"] for item in line_items]
    category = categorise_with_gemini(
        item_descriptions,
        amount,
        row.get("currency", "USD"),
        fallback_text=row.get("raw_text", ""),
    )
    line_items_json = json.dumps(line_items)
    updates.append((category, line_items_json, row["id"]))
    print(f"  [{row['id']}] {row['vendor']} -> {category} (items: {item_descriptions[:2]})")

conn.executemany(
    "UPDATE invoices SET category=?, line_items=? WHERE id=?",
    updates
)
conn.commit()
conn.close()
print(f"\nBackfilled {len(updates)} invoices.")
