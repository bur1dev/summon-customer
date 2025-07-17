from sentence_transformers import SentenceTransformer
import numpy as np


def main():
    print("--- Phase 1: Python Embedding Test ---")

    # 1. Load the all-MiniLM-L6-v2 model
    print("\n1. Loading model: all-MiniLM-L6-v2...")
    try:
        model = SentenceTransformer("all-MiniLM-L6-v2")
        print("   Model loaded successfully.")
    except Exception as e:
        print(f"   Error loading model: {e}")
        return

    # 2. Sample product data (mimicking your categorized_products_sorted.json structure)
    sample_products_data = [
        {
            "name": "Baby Dove Sensitive Skin Care Rich Moisture Baby Wash",
            "brand": "Baby Dove",
            "category": "Baby",
            "subcategory": "Baby Bath",
            "product_type": "Body Wash & Soap",
            "description": "Baby Dove Sensitive Skin Care Rich Moisture Baby Wash for delicate skin effectively cleanses and nourishes.",  # Added a bit more detail
        },
        {
            "name": "Organic Strawberries",
            "brand": "Simple Truth Organic",
            "category": "Produce",
            "subcategory": "Fresh Fruits",
            "product_type": "Berries",
            "description": "Fresh, ripe, and juicy organic strawberries, perfect for snacking or desserts.",
        },
        {
            "name": "Coca-Cola Classic",
            "brand": "Coca-Cola",
            "category": "Beverages",
            "subcategory": "Soft Drinks",
            "product_type": "Cola",
            "description": "The original great taste of Coca-Cola, a classic sparkling cola beverage.",
        },
    ]

    # 3. Construct text strings for embedding
    print("\n2. Constructing text strings for embedding...")
    texts_to_embed = []
    for i, p_data in enumerate(sample_products_data):
        # Construct a comprehensive text string for embedding
        # You can experiment with different combinations here.
        # Order might matter slightly, but including key fields is important.
        text = (
            f"{p_data.get('name', '')} "
            f"{p_data.get('brand', '')} "
            f"{p_data.get('category', '')} "
            f"{p_data.get('subcategory', '')} "
            f"{p_data.get('product_type', '')} "
            f"{p_data.get('description', '')}"
        )
        texts_to_embed.append(
            text.strip().lower()
        )  # Normalize to lowercase, remove extra spaces
        print(
            f'   Product {i+1} text: "{texts_to_embed[-1][:100]}..."'
        )  # Print first 100 chars

    # 4. Generate FP32 embeddings
    print("\n3. Generating FP32 embeddings...")
    try:
        embeddings_fp32 = model.encode(texts_to_embed)
        print(f"   Generated {len(embeddings_fp32)} FP32 embeddings.")
        print(f"   Shape of FP32 embeddings array: {embeddings_fp32.shape}")
        if embeddings_fp32.size > 0:
            print(f"   Data type of FP32 embeddings: {embeddings_fp32.dtype}")
            print(f"   First FP32 embedding (first 5 values): {embeddings_fp32[0, :5]}")
    except Exception as e:
        print(f"   Error generating FP32 embeddings: {e}")
        return

    # 5. Quantize to FP16
    print("\n4. Quantizing embeddings to FP16...")
    try:
        embeddings_fp16 = embeddings_fp32.astype(np.float16)
        print(f"   Quantized to FP16 embeddings.")
        print(f"   Shape of FP16 embeddings array: {embeddings_fp16.shape}")
        if embeddings_fp16.size > 0:
            print(f"   Data type of FP16 embeddings: {embeddings_fp16.dtype}")
            print(f"   First FP16 embedding (first 5 values): {embeddings_fp16[0, :5]}")
    except Exception as e:
        print(f"   Error quantizing to FP16: {e}")
        return

    print("\n--- Python Embedding Test Complete ---")


if __name__ == "__main__":
    main()
