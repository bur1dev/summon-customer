#!/usr/bin/env python3

import json


def count_soft_drinks(file_path="categorized_products.json"):
    with open(file_path, "r") as f:
        products = json.load(f)

    # Count products with category "Beverages" and subcategory "Soft Drinks"
    soft_drinks_count = 0
    for product in products:
        category = product.get("category", "")
        subcategory = product.get("subcategory") or ""

        # Check for different variations
        if category.lower() == "beverages" and subcategory.lower() == "soft drinks":
            soft_drinks_count += 1

    print(f"Total Soft Drinks products: {soft_drinks_count}")

    # Also show breakdown by product_type
    product_types = {}
    for product in products:
        category = product.get("category", "")
        subcategory = product.get("subcategory") or ""
        product_type = product.get("product_type") or "No Type"

        if category.lower() == "beverages" and subcategory.lower() == "soft drinks":
            product_types[product_type] = product_types.get(product_type, 0) + 1

    print("\nBreakdown by product_type:")
    for ptype, count in sorted(product_types.items()):
        print(f"  {ptype}: {count}")


if __name__ == "__main__":
    count_soft_drinks()
