"""
process.py
Clean extracted invoices, categorise (Gemini using line items ONLY), and flag duplicates.
Reads: data/extracted_invoices.csv
Writes: data/processed_invoices.csv
"""
import re
import os
import json
import pandas as pd
from pathlib import Path
from difflib import SequenceMatcher
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

INPUT_CSV = Path("data/extracted_invoices.csv")
OUTPUT_CSV = Path("data/processed_invoices.csv")

# Gemini setup for categorisation (using newer google.genai SDK)
_genai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

VALID_CATEGORIES = [
    "Food & Dining",
    "Travel",
    "Utilities",
    "Office Supplies",
    "Software & Subscriptions",
    "Transportation",
    "Healthcare",
    "Other",
]


def clean_amount(val):
    """Handle European format: '194,82' -> 194.82, '1 028,36' -> 1028.36"""
    if pd.isna(val) or val == "":
        return None
    s = str(val).strip()
    s = s.replace(" ", "")
    s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def clean_date(val):
    if pd.isna(val) or val == "":
        return None
    return pd.to_datetime(val, errors="coerce")


def clean_vendor(val):
    if pd.isna(val) or val == "":
        return ""
    return str(val).strip().title()


def extract_item_descriptions(raw_text):
    """Extract product/service descriptions from Document AI raw_text.

    The Invoice Parser didn't return structured line_items, so we parse
    the raw OCR text. Looks for description-like lines between ITEMS
    section and SUMMARY section.
    """
    if pd.isna(raw_text) or raw_text == "":
        return []

    text = str(raw_text)
    descriptions = []

    # Try to find content between ITEMS and SUMMARY
    items_match = re.search(
        r"(?:ITEMS|Items|items)(.*?)(?:SUMMARY|Summary|summary)",
        text,
        re.DOTALL | re.IGNORECASE,
    )
    if items_match:
        items_section = items_match.group(1)
    else:
        items_section = text

    # Header / noise words to skip (case-insensitive)
    SKIP_WORDS = {
        "no.", "description", "qty", "um", "net price", "net worth",
        "vat [%]", "gross", "worth", "each", "pcs", "unit", "units",
        "total", "subtotal", "tax", "vat", "gross worth",
    }

    # Split into lines and filter for description-like lines
    lines = items_section.split("\n")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if re.match(r"^\d+\.\s*$", line):               # "1."
            continue
        if re.match(r"^\d+[,.]?\d*$", line):            # "4,00" or "13" or "13.99"
            continue
        if re.match(r"^\d+%$", line):                    # "10%"
            continue
        if re.match(r"^[A-Z]$", line):                  # single capital letter
            continue
        if line.lower() in SKIP_WORDS:
            continue
        if re.match(r"^[\d\s,.\$%]+$", line):           # only numbers/symbols
            continue
        if len(line) < 4:
            continue
        # This looks like a description
        descriptions.append(line)

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for d in descriptions:
        if d not in seen:
            seen.add(d)
            unique.append(d)

    return unique[:8]  # Limit to first 8 items for prompt size



def line_items_from_row(row):
    """Prefer Document AI's structured line_item entities over raw-text parsing."""
    raw = row.get("line_items")
    if isinstance(raw, str) and raw.strip():
        try:
            items = json.loads(raw)
        except json.JSONDecodeError:
            items = []
        descs = []
        for item in items if isinstance(items, list) else []:
            desc = item.get("description") or item.get("line_item/description") or ""
            desc = str(desc).strip()
            if desc and desc not in descs:
                descs.append(desc)
        if descs:
            return descs[:8]
    return extract_item_descriptions(row.get("raw_text", ""))


def categorise_rules_items(line_items):
    """Fallback rule-based categorisation using line items ONLY (not vendor name)."""
    if not line_items:
        return "Other"

    text = " ".join(line_items).lower()
    keywords = {
        "Food & Dining": ["food", "grocery", "supermarket", "restaurant", "cafe", "coffee",
                          "pizza", "burger", "sandwich", "meal", "lunch", "dinner", "bakery",
                          "dining", "beverage", "drink", "snack", "latte", "espresso"],
        "Travel": ["flight", "airline", "hotel", "motel", "taxi", "train", "railway",
                   "booking", "lodging", "car rental", "airfare", "ride", "room"],
        "Utilities": ["electricity", "electric", "water", "internet", "broadband",
                      "phone", "telecom", "utility", "energy", "fiber", "mobile"],
        "Office Supplies": ["paper", "pen", "ink", "toner", "stationery", "notebook",
                            "staples", "folder", "binder", "envelope", "clip", "desk",
                            "chair", "printer"],
        "Software & Subscriptions": ["software", "subscription", "saas", "cloud", "license",
                                     "hosting", "streaming", "music", "api"],
        "Transportation": ["fuel", "gasoline", "petrol", "diesel", "parking",
                           "vehicle", "auto", "toll", "tires"],
        "Healthcare": ["medicine", "pharmacy", "medical", "drug", "clinic", "hospital",
                       "doctor", "dental", "health", "vitamin", "supplement", "first aid"],
    }
    for category, kws in keywords.items():
        for kw in kws:
            if kw in text:
                return category
    return "Other"


def categorise_with_gemini(line_items, amount, currency):
    """Ask Gemini to categorise based ONLY on line items purchased.
    
    Vendor name is intentionally NOT used — a vendor can sell anything.
    Falls back to rule-based item matching if API fails.
    """
    if not line_items:
        return "Other"

    items_text = "; ".join(line_items)
    prompt = f"""
    Categorise this invoice into exactly one category based on what was purchased:
    {', '.join(VALID_CATEGORIES)}

    Amount: {amount} {currency}
    Items purchased: {items_text}

    Base the category ONLY on the line items (products/services bought), NOT the vendor name.
    For example, Amazon selling paper = Office Supplies; Amazon selling groceries = Food & Dining.

    Categories:
    - Food & Dining: meals, groceries, coffee, restaurant food, snacks
    - Travel: flights, hotels, taxis, train tickets, car rentals
    - Utilities: electricity, water, gas, internet, phone bills
    - Office Supplies: paper, pens, ink, stationery, printer supplies
    - Software & Subscriptions: SaaS, streaming, cloud services, licenses
    - Transportation: fuel, gas, parking, vehicle parts
    - Healthcare: medicine, pharmacy, medical equipment, doctor visits
    - Other: anything that doesn't fit above (books, furniture, electronics, clothing, etc.)

    Reply with ONLY the category name. No explanation. No extra text.
    """
    try:
        resp = _genai_client.models.generate_content(
            model=_GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0),
        )
        cat = resp.text.strip()
        cat = cat.replace('"', "").replace("*", "").strip()
        if cat in VALID_CATEGORIES:
            return cat
        for valid in VALID_CATEGORIES:
            if valid.lower() in cat.lower() or cat.lower() in valid.lower():
                return valid
        return "Other"
    except Exception as e:
        print(f"  Gemini categorise failed ({e}), using rule-based fallback.")
        return categorise_rules_items(line_items)


def run_processing():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(
            f"{INPUT_CSV} not found. Run extract.py first."
        )

    df = pd.read_csv(INPUT_CSV)

    # Clean core fields
    df["vendor"] = df.get("vendor", "").apply(clean_vendor)
    df["amount"] = df.get("amount", "").apply(clean_amount)
    if "net_amount" in df.columns:
        # Keep receipts where the parser returned only a net amount.
        df["amount"] = df["amount"].fillna(df["net_amount"].apply(clean_amount))
    df["currency"] = (
        df.get("currency", "USD")
        .fillna("USD")
        .astype(str)
        .str.upper()
        .replace({"$": "USD", "US$": "USD", "DOLLAR": "USD", "": "USD", "NAN": "USD"})
    )
    df["date"] = df.get("date", "").apply(clean_date)
    df["invoice_id"] = df.get("invoice_id", "").fillna("").astype(str)

    # Extract line items, preferring structured Document AI entities
    df["line_items_list"] = df.apply(line_items_from_row, axis=1)

    # Drop rows with no amount
    df = df.dropna(subset=["amount"]).copy()

    # Categorise: Gemini using line items ONLY — never vendor name
    categories = []
    for idx, row in df.iterrows():
        amount = row["amount"]
        currency = row["currency"]
        line_items = row["line_items_list"]
        cat = categorise_with_gemini(line_items, amount, currency)
        categories.append(cat)
        items_preview = ", ".join(line_items[:2]) if line_items else "none"
        print(f"  {row['vendor']} -> {cat} (items: {items_preview})")

    df["category"] = categories

    # Duplicate detection
    df = df.sort_values("date").reset_index(drop=True)
    df["is_duplicate"] = False
    df["duplicate_reason"] = ""

    # Exact: same vendor + amount + date
    df["dup_key_exact"] = (
        df["vendor"].str.lower().str.strip()
        + "|" + df["amount"].round(2).astype(str)
        + "|" + df["date"].dt.strftime("%Y-%m-%d").fillna("")
    )
    exact_mask = df.duplicated(subset=["dup_key_exact"], keep=False)
    df.loc[exact_mask, "is_duplicate"] = True
    df.loc[exact_mask, "duplicate_reason"] = (
        "Exact match: same vendor, amount, and date"
    )

    # Fuzzy: similar vendor name, same amount, date within 2 days
    for i in range(len(df)):
        if df.loc[i, "is_duplicate"]:
            continue
        for j in range(i + 1, len(df)):
            if df.loc[j, "is_duplicate"]:
                continue
            if (
                abs(df.loc[i, "amount"] - df.loc[j, "amount"]) < 0.01
                and pd.notna(df.loc[i, "date"])
                and pd.notna(df.loc[j, "date"])
                and abs((df.loc[i, "date"] - df.loc[j, "date"])).days <= 2
            ):
                ratio = SequenceMatcher(
                    None,
                    df.loc[i, "vendor"].lower(),
                    df.loc[j, "vendor"].lower(),
                ).ratio()
                if ratio > 0.85:
                    df.loc[j, "is_duplicate"] = True
                    df.loc[j, "duplicate_reason"] = (
                        f"Fuzzy match: similar vendor '{df.loc[i, 'vendor']}' "
                        f"({ratio:.0%} match), same amount, date within 2 days"
                    )
                    df.loc[i, "is_duplicate"] = True
                    if not df.loc[i, "duplicate_reason"]:
                        df.loc[i, "duplicate_reason"] = (
                            f"Fuzzy match: similar vendor '{df.loc[j, 'vendor']}' "
                            f"({ratio:.0%} match), same amount, date within 2 days"
                        )

    # Save
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    try:
        df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")
    except PermissionError:
        # File may be open in another process; write to backup name
        backup = OUTPUT_CSV.parent / "processed_invoices_backup.csv"
        df.to_csv(backup, index=False, encoding="utf-8")
        print(f"\nWarning: {OUTPUT_CSV} is open/locked. Saved to {backup} instead.")
        print(f"Please close {OUTPUT_CSV} and re-run process.py to save to the correct file.")
        return df
    print(f"\nProcessed {len(df)} invoices -> {OUTPUT_CSV}")
    print(f"Duplicates flagged: {int(df['is_duplicate'].sum())}")
    print("\nCategory breakdown:")
    print(df["category"].value_counts().to_string())
    return df


if __name__ == "__main__":
    run_processing()