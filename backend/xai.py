"""
xai.py
Generate explainable AI explanations using Gemini 1.5 Flash.
Reads: data/processed_invoices.csv
Writes: data/processed_with_xai.csv
"""
import os
import pandas as pd
from pathlib import Path
from google import genai
from dotenv import load_dotenv

load_dotenv()

INPUT_CSV = Path("data/processed_invoices.csv")
OUTPUT_CSV = Path("data/processed_with_xai.csv")

# Gemini setup using newer google.genai SDK
_genai_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
_GEMINI_MODEL = "gemini-1.5-flash"


def explain_duplicate(row):
    prompt = f"""
    You are an XAI assistant for invoice spend analysis.
    Explain in one short sentence why this invoice was flagged as a duplicate.

    Vendor: {row['vendor']}
    Amount: {row['amount']} {row['currency']}
    Date: {row['date']}
    Invoice ID: {row['invoice_id']}
    Duplicate reason: {row['duplicate_reason']}

    Keep it under 25 words. Start with "Flagged because..."
    """
    try:
        resp = _genai_client.models.generate_content(model=_GEMINI_MODEL, contents=prompt)
        return resp.text.strip()
    except Exception as e:
        return f"Flagged because: {row['duplicate_reason']}"


def explain_anomaly(row, vendor_avg):
    prompt = f"""
    You are an XAI assistant. Explain why this invoice amount is anomalous.

    Vendor: {row['vendor']}
    Amount: {row['amount']} {row['currency']}
    Category: {row['category']}
    This vendor's average spend: {vendor_avg:.2f} {row['currency']}

    One sentence, under 25 words. Start with "Flagged because..."
    """
    try:
        resp = _genai_client.models.generate_content(model=_GEMINI_MODEL, contents=prompt)
        return resp.text.strip()
    except Exception as e:
        return f"Flagged because amount {row['amount']} deviates from vendor average {vendor_avg:.2f}"


def explain_category(row):
    items = row.get("line_items_list", "")
    if isinstance(items, str):
        items_text = f" Items: {items}" if items and items not in ["", "[]", "nan"] else ""
    elif isinstance(items, list):
        items_text = f" Items: {', '.join(items[:3])}" if items else ""
    else:
        items_text = ""
    prompt = f"""
    You are an XAI assistant. Explain why this invoice was categorised as '{row['category']}'.

    Items purchased: {items_text if items_text else 'no line items available'}

    Base the explanation on what was purchased, not the vendor name.
    One sentence, under 25 words. Start with "Categorised as..."
    """
    try:
        resp = _genai_client.models.generate_content(model=_GEMINI_MODEL, contents=prompt)
        return resp.text.strip()
    except Exception as e:
        return f"Categorised as {row['category']} based on purchased items"


def explain_pattern(df):
    """Generate high-level spending pattern insights using Gemini."""
    if df.empty:
        return "No data available for pattern analysis."

    total_spend = df["amount"].sum()
    bill_count = len(df)
    top_category = df.groupby("category")["amount"].sum().idxmax() if "category" in df.columns else "N/A"
    top_vendor = df.groupby("vendor")["amount"].sum().idxmax() if "vendor" in df.columns else "N/A"
    avg_bill = df["amount"].mean()

    # Check for impulsive spending: high variance in amounts
    amount_std = df["amount"].std()
    amount_cv = amount_std / avg_bill if avg_bill > 0 else 0

    # Check purchase frequency: many bills in short time = frequent buyer
    if "date" in df.columns and df["date"].notna().any():
        date_range = (df["date"].max() - df["date"].min()).days
        bills_per_month = bill_count / max(date_range / 30, 1)
    else:
        bills_per_month = 0

    prompt = f"""
    You are an XAI assistant analyzing spending patterns from invoice data.

    Data summary:
    - Total spend: {total_spend:,.2f} USD
    - Number of bills: {bill_count}
    - Average bill value: {avg_bill:,.2f} USD
    - Top spending category: {top_category}
    - Top vendor: {top_vendor}
    - Coefficient of variation (amount variance): {amount_cv:.2f}
    - Bills per month: {bills_per_month:.1f}

    Provide 3-4 short insights about the buyer's spending behavior:
    1. What they spend most on (category)
    2. Whether they appear impulsive (high variance = impulsive, low = consistent)
    3. Purchase frequency pattern
    4. Any notable observation about vendors or categories

    Keep each insight under 20 words. Start each with a bullet point. No extra intro text.
    """
    try:
        resp = _genai_client.models.generate_content(model=_GEMINI_MODEL, contents=prompt)
        return resp.text.strip()
    except Exception as e:
        # Fallback rule-based pattern insights
        insights = []
        insights.append(f"- Top category: {top_category} - highest spend area")
        if amount_cv > 1.0:
            insights.append(f"- Impulsive buyer: high variance in bill amounts")
        else:
            insights.append(f"- Consistent buyer: stable bill amounts")
        if bills_per_month > 5:
            insights.append(f"- Frequent purchaser: {bills_per_month:.0f} bills/month")
        else:
            insights.append(f"- Occasional purchaser: {bills_per_month:.1f} bills/month")
        insights.append(f"- Top vendor: {top_vendor}")
        return "\n".join(insights)


def run_xai():
    if not INPUT_CSV.exists():
        raise FileNotFoundError(
            f"{INPUT_CSV} not found. Run process.py first."
        )

    df = pd.read_csv(INPUT_CSV)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")

    # Vendor average for anomaly detection
    vendor_avg = df.groupby("vendor")["amount"].transform("mean")
    df["vendor_avg"] = vendor_avg
    df["amount_ratio"] = df["amount"] / df["vendor_avg"]

    # Anomaly: amount > 3x vendor average
    df["is_anomaly"] = df["amount_ratio"] > 3.0

    # Generate explanations (limit to flagged rows to save API calls / cost)
    explanations = {}
    for idx, row in df.iterrows():
        key = str(idx)
        if row.get("is_duplicate", False):
            explanations[key] = explain_duplicate(row)
        elif row.get("is_anomaly", False):
            explanations[key] = explain_anomaly(row, row["vendor_avg"])
        else:
            explanations[key] = explain_category(row)

    df["xai_explanation"] = df.index.map(lambda i: explanations.get(str(i), ""))

    # Generate pattern-level insights
    pattern_insights = explain_pattern(df)

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_CSV, index=False, encoding="utf-8")

    # Save pattern insights to a separate file
    pattern_file = OUTPUT_CSV.parent / "pattern_insights.txt"
    with open(pattern_file, "w", encoding="utf-8") as f:
        f.write(pattern_insights)

    print(f"XAI explanations generated -> {OUTPUT_CSV}")
    print(f"Pattern insights -> {pattern_file}")
    print("\nPattern Insights:\n" + pattern_insights)
    return df, pattern_insights


if __name__ == "__main__":
    run_xai()