import json
import sys


def sort_products_file(file_path):
    # Load the JSON file
    with open(file_path, "r") as f:
        products = json.load(f)

    print(f"Loaded {len(products)} products")

    # Sort products by category > subcategory > product_type > name
    sorted_products = sorted(
        products,
        key=lambda x: (
            x.get("category", ""),
            x.get("subcategory", "") or "",  # Handle None values
            x.get("product_type", "") or "",  # Handle None values
            x.get("description", ""),  # Sort by product name last
        ),
    )

    # Write sorted products back to file
    sorted_file_path = file_path.replace(".json", "_sorted.json")
    with open(sorted_file_path, "w") as f:
        json.dump(sorted_products, f, indent=2)

    print(f"Sorted {len(sorted_products)} products and saved to {sorted_file_path}")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
    else:
        file_path = "categorized_products.json"

    sort_products_file(file_path)
