import json
import os
from sentence_transformers import SentenceTransformer
import numpy as np
import time

# --- Configuration ---
INPUT_FILE_PATH = (
    "categorized_products_sorted.json"  # Assumes this script is in the same dir
)
OUTPUT_FILE_PATH = "categorized_products_sorted_with_embeddings.json"
MODEL_NAME = "all-mpnet-base-v2"
BATCH_SIZE = 32  # Adjust based on your RAM capacity


def construct_product_text(product: dict) -> str:
    """
    Constructs a single text string for a product to be used for embedding.
    Adjust fields and formatting as needed for best semantic representation.
    """
    name = product.get("name", "") or product.get(
        "description", ""
    )  # Prioritize name, fallback to description
    brand = product.get("brand", "")
    category = product.get("category", "")
    subcategory = product.get("subcategory", "")
    product_type = product.get("product_type", "")

    # Fallback for name if still empty
    if not name and product.get("productId"):
        name = f"Product ID {product.get('productId')}"

    # Ensure all parts are strings and handle None values gracefully
    parts = [
        str(name if name else ""),
        str(brand if brand else ""),
        str(category if category else ""),
        str(subcategory if subcategory else ""),
        str(product_type if product_type else ""),
    ]

    # You might want to experiment with adding other fields like 'size'
    # or parts of the 'description' if you have a separate detailed description field.
    # For now, using the main identifying fields.

    text = " ".join(filter(None, parts))  # Join non-empty parts
    return text.strip().lower()  # Normalize


def main():
    print(f"--- Product Embedding Generation (Model: {MODEL_NAME}) ---")

    # Resolve absolute paths
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_path = os.path.join(script_dir, INPUT_FILE_PATH)
    output_path = os.path.join(script_dir, OUTPUT_FILE_PATH)

    print(f"1. Loading products from: {input_path}")
    if not os.path.exists(input_path):
        print(f"   ERROR: Input file not found at {input_path}")
        return

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            products = json.load(f)
        print(f"   Loaded {len(products)} products.")
        if not products:
            print("   Input file is empty. Exiting.")
            return
    except json.JSONDecodeError as e:
        print(f"   ERROR: Could not decode JSON from {input_path}. Error: {e}")
        return
    except Exception as e:
        print(f"   ERROR: An unexpected error occurred while loading products: {e}")
        return

    print(f"\n2. Loading sentence transformer model: {MODEL_NAME}...")
    try:
        model = SentenceTransformer(MODEL_NAME)
        print("   Model loaded successfully.")
    except Exception as e:
        print(f"   ERROR: Could not load model '{MODEL_NAME}'. Error: {e}")
        return

    products_with_embeddings = []
    total_products = len(products)
    start_time_total = time.time()

    print(f"\n3. Generating embeddings in batches of {BATCH_SIZE}...")

    for i in range(0, total_products, BATCH_SIZE):
        batch_products = products[i : i + BATCH_SIZE]
        batch_texts = [construct_product_text(p) for p in batch_products]

        batch_start_time = time.time()
        print(
            f"   Processing batch {i//BATCH_SIZE + 1}/{(total_products + BATCH_SIZE - 1)//BATCH_SIZE} (products {i+1}-{min(i+BATCH_SIZE, total_products)})..."
        )

        if not any(batch_texts):  # Check if all texts in batch are empty
            print(f"     Skipping batch as all product texts are empty.")
            # Add products to output without embeddings or with null embeddings
            for product in batch_products:
                product["embedding"] = None  # Or []
                products_with_embeddings.append(product)
            continue

        try:
            # Generate FP32 embeddings
            embeddings_fp32 = model.encode(batch_texts, show_progress_bar=False)

            # The FP16 quantization step is now removed.

            batch_end_time = time.time()
            print(
                f"     Batch encoded in {batch_end_time - batch_start_time:.2f} seconds."  # Message updated
            )

            # Iterate through the original FP32 embeddings
            for product, embedding_fp32_single in zip(
                batch_products, embeddings_fp32
            ):  # Use embeddings_fp32
                # Convert numpy FP32 array to a Python list of floats for JSON serialization
                product["embedding"] = (
                    embedding_fp32_single.tolist()
                )  # Use embedding_fp32_single
                products_with_embeddings.append(product)

        except Exception as e:
            print(f"     ERROR processing batch starting at index {i}: {e}")
            print(
                f"     Problematic texts in this batch (first 50 chars): {[text[:50] for text in batch_texts]}"
            )
            # Add products from this failed batch to output without embeddings
            for product in batch_products:
                product["embedding"] = (
                    None  # Or handle as you see fit, e.g., an empty list
                )
                products_with_embeddings.append(product)
            # Optionally, decide if you want to stop on error or continue
            # continue

    end_time_total = time.time()
    print(
        f"\n   Total embedding generation took {end_time_total - start_time_total:.2f} seconds."
    )

    print(
        f"\n4. Saving {len(products_with_embeddings)} products with embeddings to: {output_path}"
    )
    try:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(
                products_with_embeddings, f, indent=2
            )  # indent=2 for pretty printing
        print("   Successfully saved products with embeddings.")
    except Exception as e:
        print(f"   ERROR: Could not save output file. Error: {e}")

    print("\n--- Product Embedding Generation Complete ---")


if __name__ == "__main__":
    main()
