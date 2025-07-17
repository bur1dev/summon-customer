import json
import os
from datetime import datetime


def extract_categories_from_ts(ts_content):
    categories = []
    blocks = ts_content.split("\n  {")

    for block in blocks[1:]:
        if "name:" not in block:
            continue

        cat_name = block.split('name: "')[1].split('"')[0]
        subcategories = []

        if "subcategories: [" in block:
            sub_blocks = block.split("\n      {")

            for sub in sub_blocks[1:]:
                if "name:" not in sub:
                    continue

                sub_name = sub.split('name: "')[1].split('"')[0]
                is_grid_only = "gridOnly: true" in sub

                product_types = []  # Removed default 'All'
                if "productTypes: [" in sub:
                    types_block = sub[sub.find("productTypes: [") : sub.find("]")]
                    types = [
                        t.strip().strip('"').strip('",')
                        for t in types_block.split("\n")[1:]
                    ]  # Added strip('",')
                    product_types = [
                        t for t in types if t and t != "All"
                    ]  # Filter out empty and 'All'

                subcategories.append(
                    {
                        "name": sub_name,
                        "gridOnly": is_grid_only,
                        "productTypes": product_types,
                    }
                )

        categories.append({"name": cat_name, "subcategories": subcategories})

    return categories


def create_faiss_training_data(categories):
    training_data = []

    for category in categories:
        for subcategory in category["subcategories"]:
            if subcategory["gridOnly"]:
                training_data.append(
                    {
                        "text": f"{category['name']} {subcategory['name']}",
                        "category": category["name"],
                        "subcategory": subcategory["name"],
                        "product_type": subcategory[
                            "name"
                        ],  # Use subcategory name instead of "All"
                    }
                )
            else:
                for product_type in subcategory["productTypes"]:
                    training_data.append(
                        {
                            "text": f"{category['name']} {subcategory['name']} {product_type}",
                            "category": category["name"],
                            "subcategory": subcategory["name"],
                            "product_type": product_type,
                        }
                    )

    return training_data


def enrich_training_data_with_corrections(training_data):
    """Add approved corrections as additional training examples"""
    corrections_file = "reported_categorizations.jsonl"

    if not os.path.exists(corrections_file):
        print("No corrections file found, using base training data")
        return training_data

    enriched_data = list(training_data)  # Create a copy
    added = 0

    with open(corrections_file, "r") as f:
        for line in f:
            if not line.strip():
                continue

            try:
                report = json.loads(line)
                # Only use approved reports
                if report.get("status") == "approved":
                    # Create training example from product name
                    product_name = report["product"]["name"]
                    category = report["suggestedCategory"]["category"]
                    subcategory = report["suggestedCategory"]["subcategory"]
                    product_type = report["suggestedCategory"]["product_type"]

                    # Create three types of examples with different formats
                    examples = [
                        # Format 1: Category + Subcategory + Product name
                        {
                            "text": f"{category} {subcategory} {product_name}",
                            "category": category,
                            "subcategory": subcategory,
                            "product_type": product_type,
                        },
                        # Format 2: Just product name (helps with direct matching)
                        {
                            "text": product_name,
                            "category": category,
                            "subcategory": subcategory,
                            "product_type": product_type,
                        },
                        # Format 3: Category + Product Name
                        {
                            "text": f"{category} {product_name}",
                            "category": category,
                            "subcategory": subcategory,
                            "product_type": product_type,
                        },
                    ]

                    # Add multiple copies of each format for higher weighting
                    for example in examples:
                        # Add each example 3 times for stronger weighting
                        for _ in range(3):
                            enriched_data.append(example)

                    added += 1
            except Exception as e:
                print(f"Error processing report: {e}")
                continue

    print(
        f"Added {added} correction examples ({added * 9} total entries) to training data"
    )
    return enriched_data


if __name__ == "__main__":
    with open("categoryData.ts", "r") as f:
        print("Reading categoryData.ts...")
        ts_content = f.read()
        print("Content length:", len(ts_content))

    categories = extract_categories_from_ts(ts_content)
    training_data = create_faiss_training_data(categories)

    # Enhance with corrections
    enriched_data = enrich_training_data_with_corrections(training_data)

    with open("categories.json", "w") as f:
        json.dump(categories, f, indent=2)

    with open("training_data.json", "w") as f:
        json.dump(enriched_data, f, indent=2)

    print(f"Generated training_data.json with {len(enriched_data)} entries")
