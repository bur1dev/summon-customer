#!/usr/bin/env python3
import sys
import json
import os
import logging

# Configure logging to output to stderr
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - PYTHON DUAL BRIDGE - %(name)s - %(levelname)s - %(message)s",
    stream=sys.stderr,
)

# Add parent directory to path to ensure imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Import the dual categorization function
from dual_categories import get_categorizations


def process_products(products_json):
    try:
        products = json.loads(products_json)
        results = []

        print(f"📝 Processing {len(products)} products in dual_bridge", file=sys.stderr)

        # Process each product
        for i, product in enumerate(products):
            print(
                f"🔄 Processing product {i+1}: {product.get('description', 'Unknown')}",
                file=sys.stderr,
            )

            # Skip if product doesn't have required fields
            if not all(
                k in product for k in ["category", "subcategory", "product_type"]
            ):
                print(
                    f"Warning: Product missing required fields: {product.get('description', 'Unknown')}",
                    file=sys.stderr,
                )
                product["additional_categorizations"] = []
                results.append(product)
                continue

            print(
                f"  📊 Product category: {product['category']}/{product['subcategory']}/{product['product_type']}",
                file=sys.stderr,
            )

            # Get additional categorizations
            additional_cats = get_categorizations(
                product["category"], product["subcategory"], product["product_type"]
            )

            print(
                f"  📋 Found {len(additional_cats) if additional_cats else 0} additional categorizations",
                file=sys.stderr,
            )

            # Always add the field, even if empty
            product["additional_categorizations"] = (
                additional_cats if additional_cats else []
            )

            results.append(product)

        print(f"✅ Processed {len(results)} products, returning JSON", file=sys.stderr)
        result_json = json.dumps(results)
        return result_json
    except Exception as e:
        print(f"Error in dual_bridge: {str(e)}", file=sys.stderr)
        # Return original input if processing fails
        return products_json


if __name__ == "__main__":
    # Read input from stdin
    input_json = sys.stdin.read()
    output_json = process_products(input_json)
    print(output_json)
