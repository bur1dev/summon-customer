// Common qualifiers for parsing search queries
export const COMMON_QUALIFIERS = [
    "organic", "fresh", "large", "small", "red", "green",
    "frozen", "canned", "seedless", "ripe", "raw",
    "low-fat", "whole", "sliced", "diced", "natural"
];

// Master mapping of ambiguous terms to their type hints or expanded variations
export const AMBIGUOUS_TERM_TYPE_HINTS: Record<string, string | string[]> = {
    // Fruits
    "apple": "fruit", "apples": "fruit",
    "apricot": "fruit", "apricots": "fruit",
    "avocado": "fruit", "avocados": "fruit",
    "banana": "fruit", "bananas": "fruit",
    "berry": "fruit", "berries": "fruit",
    "blueberry": "fruit", "blueberries": "fruit",
    "cantaloupe": "fruit", "cantaloupes": "fruit",
    "grape": "fruit", "grapes": "fruit",
    "grapefruit": "fruit", "grapefruits": "fruit",
    "honeydew": "fruit", "honeydews": "fruit",
    "kiwi": "fruit", "kiwis": "fruit",
    "lemon": "fruit", "lemons": "fruit",
    "lime": "fruit", "limes": "fruit",
    "mango": "fruit", "mangos": "fruit",
    "melon": "fruit", "melons": "fruit",
    "orange": "fruit", "oranges": "fruit",
    "peach": "fruit", "peaches": "fruit",
    "pear": "fruit", "pears": "fruit",
    "persimmon": "fruit", "persimmons": "fruit",
    "pineapple": "fruit", "pineapples": "fruit",
    "plum": "fruit", "plums": "fruit",
    "pomegranate": "fruit", "pomegranates": "fruit",
    "raspberry": "fruit", "raspberries": "fruit",
    "strawberry": "fruit", "strawberries": "fruit",
    "watermelon": "fruit", "watermelons": "fruit",
    "tomato": "fruit", "tomatoes": "fruit",

    // Vegetables
    "asparagus": "vegetable",
    "bean": "vegetable", "beans": "vegetable",
    "beet": "vegetable", "beets": "vegetable",
    "broccoli": "vegetable",
    "cabbage": "vegetable", "cabbages": "vegetable",
    "carrot": "vegetable", "carrots": "vegetable",
    "cauliflower": "vegetable",
    "celery": "vegetable",
    "corn": "vegetable",
    "cucumber": "vegetable", "cucumbers": "vegetable",
    "eggplant": "vegetable", "eggplants": "vegetable",
    "garlic": "vegetable",
    "gourd": "vegetable", "gourds": "vegetable",
    "kale": "vegetable",
    "lettuce": "vegetable", "lettuces": "vegetable",
    "mushroom": "vegetable", "mushrooms": "vegetable",
    "onion": "vegetable", "onions": "vegetable",
    "pea": "vegetable", "peas": "vegetable",
    "pepper": "vegetable", "peppers": "vegetable",
    "potato": [
        "potato vegetable",
        "fresh potato",
        "whole potato",
        "russet potato",
        "produce potato"
    ],
    "potatoes": [
        "potatoes vegetable",
        "fresh potatoes",
        "whole potatoes",
        "russet potatoes",
        "produce potatoes"
    ],
    "radish": "vegetable", "radishes": "vegetable",
    "spinach": "vegetable",
    "sprout": "vegetable", "sprouts": "vegetable",
    "squash": "vegetable", "squashes": "vegetable",
    "yam": "vegetable", "yams": "vegetable",

    // Other categories
    "herb": "seasoning", "herbs": "seasoning",
    "bread": "bakery",
    "butter": "dairy",
    "cheese": "dairy", "cheeses": "dairy",
    "chicken": [
        "chicken meat",
        "raw chicken",
        "fresh chicken",
        "uncooked chicken",
        "whole chicken"
    ],
    "cream": "dairy",
    "egg": "protein", "eggs": "protein",
    "fish": "seafood",
    "flour": "baking",
    "juice": "beverage",
    "milk": "dairy", "milks": "dairy",
    "oil": "pantry",
    "pasta": "grain",
    "rice": "grain",
    "salt": "seasoning",
    "soup": "meal", "soups": "meal",
    "spice": "seasoning", "spices": "seasoning",
    "sugar": "sweetener",
    "tea": "beverage", "teas": "beverage",
    "tuna": "seafood",
    "turkey": "meat",
    "water": "beverage",
    "yogurt": "dairy", "yogurts": "dairy",
    "beef": "meat",
    "pork": "meat",
    "sprite": "drink",
    "salmon": [
        "salmon seafood",
        "fresh salmon",
        "raw salmon",
        "salmon fillet",
        "uncooked salmon"
    ],
};

// Auto-generate the set from the mapping keys (always in sync!)
export const AMBIGUOUS_SINGLE_FOOD_TERMS = new Set(Object.keys(AMBIGUOUS_TERM_TYPE_HINTS));
