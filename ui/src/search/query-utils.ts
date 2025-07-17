// query-utils.ts

import { AMBIGUOUS_SINGLE_FOOD_TERMS } from './search-constants'; // Keep this import

/**
 * Checks if a query is a single-word term present in the AMBIGUOUS_SINGLE_FOOD_TERMS set.
 * @param query The search query string.
 * @returns True if the query is a single, ambiguous food term, false otherwise.
 */
export function isAmbiguousSingleFoodTerm(query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    const isSingleWord = !normalizedQuery.includes(' ');
    return isSingleWord && AMBIGUOUS_SINGLE_FOOD_TERMS.has(normalizedQuery);
}


const AMBIGUOUS_TERM_TYPE_HINTS: Record<string, string | string[]> = {

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
    "tomato": "fruit", "tomatoes": "fruit",
    "yam": "vegetable", "yams": "vegetable",


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

/**
 * Generates a list of expanded query variations for a given ambiguous single food term.
 * e.g., "orange" -> ["orange", "fresh orange", "orange fruit"]
 * @param query The ambiguous single food term.
 * @returns An array of strings with expanded queries.
 */
export function generateExpandedQueriesForAmbiguity(query: string): string[] {
    const normalizedQuery = query.trim().toLowerCase();
    const variations: string[] = [normalizedQuery];

    variations.push(`fresh ${normalizedQuery}`);

    const hintOrExpansions = AMBIGUOUS_TERM_TYPE_HINTS[normalizedQuery];
    if (hintOrExpansions) {
        if (typeof hintOrExpansions === 'string') {
            // Original behavior: query + single type hint
            variations.push(`${normalizedQuery} ${hintOrExpansions}`);
        } else {
            // New behavior for array: add each string from the array as a variation
            // These are assumed to be pre-formed, complete search phrases
            variations.push(...hintOrExpansions);
        }
    } else {
        // Original generic fallback if no entry in AMBIGUOUS_TERM_TYPE_HINTS
        variations.push(`${normalizedQuery} food product`);
    }
    return variations;
}