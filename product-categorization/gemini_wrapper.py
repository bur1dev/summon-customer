#!/usr/bin/env python3
import json
import sys
import os
import requests
import argparse
import base64
from typing import List, Dict, Any
from pydantic import BaseModel
from google import genai
import logging
from google.api_core import exceptions as google_exceptions


# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("gemini_wrapper")

# Configure API key
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    logger.error("Error: GEMINI_API_KEY environment variable not set")
    sys.exit(1)

# Initialize Gemini client
client = genai.Client(api_key=api_key)

# Cache registry for taxonomy
cache_registry = {}

MODEL = "gemini-2.5-pro-preview-05-06"


# Define Pydantic models for structured output
class ProductType(BaseModel):
    category: str
    subcategory: str
    product_type: str


class ProductTypeResult(BaseModel):
    id: str
    product_type: str


def log(message):
    """Log messages to stderr to keep stdout clean for JSON output"""
    print(message, file=sys.stderr)


def load_image(url):
    """Load image from URL and convert to base64"""
    try:
        response = requests.get(url, timeout=20)
        if not response.ok:
            log(f"Failed to load image: {url} (Status: {response.status_code})")
            return None

        image_data = base64.b64encode(response.content).decode("utf-8")
        content_type = response.headers.get("Content-Type", "image/jpeg")
        return {"mime_type": content_type, "data": image_data}
    except Exception as e:
        log(f"Error loading image {url}: {str(e)}")
        return None


def list_models_with_capabilities():
    """List available models and their supported actions"""
    log("📋 Listing available models and their capabilities:")
    try:
        for model in client.models.list():
            log(f"🔹 Model: {model.name}")
            if hasattr(model, "supported_actions"):
                log(f"  ↳ Supported actions: {model.supported_actions}")
    except Exception as e:
        log(f"❌ Error listing models: {str(e)}")


def create_taxonomy_cache(taxonomy, existing_cache_name=None):
    """Create or get cache for taxonomy"""
    taxonomy_str = json.dumps(taxonomy)

    if existing_cache_name:
        try:
            log(f"🔍 Checking for existing cache: {existing_cache_name}")
            cache = client.caches.get(name=existing_cache_name)
            log(
                f"✅ Successfully found and using existing taxonomy cache: {cache.name}"
            )
            return cache.name
        except google_exceptions.NotFound:
            log(
                f"⚠️ Existing cache {existing_cache_name} not found or expired. Creating a new one."
            )
        except Exception as e:
            log(
                f"❌ Error retrieving existing cache {existing_cache_name}: {str(e)}. Will attempt to create a new one."
            )

    try:
        log(f"🔍 Creating new cache with taxonomy ({len(taxonomy_str)} chars)")
        log(f"🔧 Attempting to create new cache with model: {MODEL}")
        cache = client.caches.create(
            model=MODEL,
            config={
                "contents": taxonomy_str,
                "system_instruction": "You are a product categorization expert that strictly follows the provided taxonomy. Always choose the most specific valid category for each product without inventing new categories.",
                "ttl": "3600s",
            },
        )
        log(f"✅ Successfully created new taxonomy cache: {cache.name}")
        if hasattr(cache, "usage_metadata"):
            log(f"📊 New cache usage metadata: {cache.usage_metadata}")
        return cache.name
    except Exception as e:
        log(f"❌ Error creating new cache: {str(e)}")
        return None


def extract_json(text):
    """Extract JSON from text response (fallback method)"""
    try:
        # First try to parse the entire response as JSON
        return json.loads(text)
    except json.JSONDecodeError:
        log("🔍 Response wasn't valid JSON, trying to extract JSON...")

        # Look for JSON array pattern
        import re

        json_match = re.search(r"\[\s*\{.*\}\s*\]", text, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass

        # Try to find JSON in code blocks
        code_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)```", text)
        for block in code_blocks:
            try:
                return json.loads(block)
            except json.JSONDecodeError:
                continue

        log(f"❌ Failed to extract JSON from response: {text[:200]}...")
        raise ValueError("Could not extract JSON from response")


def categorize_products(products, taxonomy, existing_taxonomy_cache_name=None):
    """Categorize products using Gemini API with structured output"""
    log(f"🏷️ Categorizing {len(products)} products")
    final_categorizations = []
    used_cache_name = None

    try:
        used_cache_name = create_taxonomy_cache(taxonomy, existing_taxonomy_cache_name)

        prompt_text = f"""Categorize these grocery products. ONLY use exact categories, subcategories, and product types from the taxonomy below.
CRITICAL: Do not invent or create new categories, subcategories, or product types.
IMPORTANT: Pay close attention to the hierarchical structure of the taxonomy. Each subcategory belongs to ONLY ONE specific category, and each product type belongs to ONLY ONE specific subcategory. Verify the complete path (category → subcategory → product type) is valid before assigning it.

COMPLETE TAXONOMY:
{json.dumps(taxonomy, indent=1)}

PRODUCTS TO CATEGORIZE:
"""
        for i, product in enumerate(products):
            prompt_text += f"""
PRODUCT {i + 1}:
- Description: {product.get('description', 'Unknown')}
- Brand: {product.get('brand', 'Unknown')}
- Size: {product.get('items', [{}])[0].get('size', 'Unknown') if product.get('items') else 'Unknown'}
- Temperature: {product.get('temperature', {}).get('indicator', 'Unknown')}
"""
        prompt_text += """
RESPONSE FORMAT: You must respond ONLY with a JSON array with NO explanation text.
Each item in the array must have EXACTLY these fields:
- "category": string - one of the category names from the taxonomy
- "subcategory": string - one of the subcategory names from the taxonomy
- "product_type": string - one of the product types from the taxonomy

EXAMPLE CORRECT RESPONSE FORMAT:
[
  {
    "category": "Produce",
    "subcategory": "Fresh Fruits",
    "product_type": "Apples"
  }
]
"""
        multi_content = [prompt_text]
        for i, product in enumerate(products):
            image_url = product.get("image_url")
            if image_url:
                log(f"🖼️ Loading image for product {i+1}: {image_url}")
                image_data = load_image(image_url)
                if image_data:
                    multi_content.append({"inline_data": image_data})
                    log(f"✅ Added image for product {i+1}")

        config = {
            "temperature": 0.1,
            "max_output_tokens": 65536,
            "response_mime_type": "application/json",
            "response_schema": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "category": {"type": "STRING"},
                        "subcategory": {"type": "STRING"},
                        "product_type": {"type": "STRING"},
                    },
                },
            },
        }

        if used_cache_name:
            config["cached_content"] = used_cache_name
            log(f"💾 Using taxonomy cache: {used_cache_name}")
        else:
            log(f"⚠️ Proceeding without taxonomy cache.")

        log(f"🔄 Sending categorization request to model: {MODEL}")
        response = client.models.generate_content(
            model=MODEL, contents=multi_content, config=config
        )

        if hasattr(response, "usage_metadata"):
            log(f"📊 Usage metadata: {response.usage_metadata}")
            if hasattr(
                response.usage_metadata, "token_count"
            ):  # Check attribute existence
                token_data = response.usage_metadata.token_count
                log(
                    f"📝 Token usage - Total: {getattr(token_data, 'total_tokens', 'N/A')}, Input: {getattr(token_data, 'input_tokens', 'N/A')}, Output: {getattr(token_data, 'output_tokens', 'N/A')}"
                )
            if (
                hasattr(response.usage_metadata, "cached_content_token_count")
                and response.usage_metadata.cached_content_token_count > 0
            ):
                log(
                    f"💰 Cache hit! {response.usage_metadata.cached_content_token_count} tokens (from cached_content_token_count) were served from cache"
                )

        try:
            if hasattr(response, "parsed") and response.parsed:
                parsed_results = response.parsed
                log(f"✅ Successfully used structured output parsing")
                if parsed_results:
                    log(f"🔍 Debug - results type: {type(parsed_results)}")
                    if len(parsed_results) > 0:
                        log(f"🔍 Debug - first result type: {type(parsed_results[0])}")
                        log(f"🔍 Debug - first result content: {parsed_results[0]}")
                    if isinstance(parsed_results[0], dict):
                        log(f"📋 Results are already dictionaries")
                        final_categorizations = parsed_results
                    else:
                        dict_results = []
                        for r_item in parsed_results:
                            dict_results.append(
                                {
                                    "category": r_item.category,
                                    "subcategory": r_item.subcategory,
                                    "product_type": r_item.product_type,
                                }
                            )
                        final_categorizations = dict_results
        except Exception as parse_error:
            log(
                f"⚠️ Structured parsing failed, falling back to text extraction: {parse_error}"
            )
            final_categorizations = extract_json(response.text)
            log(
                f"✅ Successfully extracted JSON with {len(final_categorizations)} products"
            )

    except Exception as e:
        log(f"❌ Error in categorize_products: {str(e)}")

    return {
        "categorizations": final_categorizations,
        "taxonomy_cache_name": used_cache_name,
    }


def determine_product_types(batch_items):
    """Determine product types for secondary categorization"""
    log(f"🔍 Determining product types for {len(batch_items)} items")

    try:
        # Create prompt with strict JSON output instructions
        prompt = """Select the most appropriate product type for each product.
        
For each item below, choose a product type from the provided options.

"""
        for i, item in enumerate(batch_items):
            prompt += f"""
Item {i + 1}:
ID: "{item['id']}"
Product: "{item['description']}"
Category: {item['category']} → {item['subcategory']}
Available product types: {json.dumps(item['availableProductTypes'])}
"""

        prompt += """
RESPONSE FORMAT: You must respond ONLY with a JSON array with NO explanation text.
Each item in the array must have EXACTLY these fields:
- "id": string - the exact ID string provided for the item
- "product_type": string - chosen from the available product types list for that item

EXAMPLE CORRECT RESPONSE FORMAT:
[
  {
    "id": "product_0_cat_0",
    "product_type": "Apples"
  }
]
"""

        # Generate with system instruction and structured output
        log(f"🔄 Sending product type determination request to model: {MODEL}")
        response = client.models.generate_content(
            model=MODEL,
            contents=prompt,
            config={
                "temperature": 0.1,
                "response_mime_type": "application/json",
                "response_schema": list[ProductTypeResult],  # Using built-in list
                "system_instruction": "You are a product categorization expert. Your task is to choose the most appropriate product type for each product from the available options provided.",
            },
        )

        # Log token usage if available
        if hasattr(response, "usage_metadata"):
            log(f"📊 Usage metadata: {response.usage_metadata}")
            if "token_count" in response.usage_metadata:
                token_data = response.usage_metadata["token_count"]
                log(
                    f"📝 Token usage - Total: {token_data.get('total_tokens')}, Input: {token_data.get('input_tokens')}, Output: {token_data.get('output_tokens')}"
                )

        # Try to parse structured output first
        try:
            if hasattr(response, "parsed") and response.parsed:
                results = response.parsed
                log(f"✅ Successfully used structured output parsing")

                # Convert to dictionary format
                dict_results = []
                for result in results:
                    dict_results.append(
                        {
                            "id": result.id,
                            "product_type": result.product_type,
                        }
                    )
                return dict_results
        except Exception as parse_error:
            log(
                f"⚠️ Structured parsing failed, falling back to text extraction: {parse_error}"
            )

        # Fall back to text extraction
        results = extract_json(response.text)
        log(f"✅ Successfully extracted JSON with {len(results)} items")
        return results

    except Exception as e:
        log(f"❌ Error in determine_product_types: {str(e)}")
        raise


def main():
    parser = argparse.ArgumentParser(description="Process products for categorization")
    parser.add_argument(
        "--mode",
        choices=["categorize", "product_types"],
        required=True,
        help="Mode of operation: categorize or determine product types",
    )
    args = parser.parse_args()

    try:
        # Read JSON from stdin
        input_text = sys.stdin.read()
        input_data = json.loads(input_text)

        if args.mode == "categorize":
            products = input_data.get("products", [])
            taxonomy = input_data.get("taxonomy", {})
            existing_taxonomy_cache_name = input_data.get(
                "existing_taxonomy_cache_name"
            )
            log(
                f"🐍 Python received existing_taxonomy_cache_name: {existing_taxonomy_cache_name}"
            )

            if not products:
                raise ValueError("No products found in input")
            if not taxonomy:
                raise ValueError("No taxonomy found in input")

            log(f"🚀 Processing {len(products)} products for categorization")
            result = categorize_products(
                products, taxonomy, existing_taxonomy_cache_name
            )

        else:  # product_types
            if not isinstance(input_data, list):
                raise ValueError(
                    "Expected a list of batch items for product_types mode"
                )

            log(f"🚀 Processing {len(input_data)} items for product type determination")
            result = determine_product_types(input_data)

        # Output the result as JSON
        print(json.dumps(result))

    except Exception as e:
        log(f"❌ Error in main: {str(e)}")
        error_output = {"error": str(e)}
        if (
            args.mode == "categorize"
            and "input_data" in locals()
            and isinstance(input_data, dict)
        ):
            error_output["taxonomy_cache_name"] = input_data.get(
                "existing_taxonomy_cache_name"
            )
        print(json.dumps(error_output))
        sys.exit(1)


if __name__ == "__main__":
    main()
