// Common qualifiers for parsing search queries
export const COMMON_QUALIFIERS = [
    "organic", "fresh", "large", "small", "red", "green",
    "frozen", "canned", "seedless", "ripe", "raw",
    "low-fat", "whole", "sliced", "diced", "natural"
];

// Category priority rules for dual categorization
export const CATEGORY_PRIORITY_RULES = [
    { term: "milk", preferredCategory: "Dairy & Eggs" },
    {
        term: "sauce",
        preferredCategory: "Dry Goods & Pasta",
        condition: (query: string) => query.includes("pasta") || query.includes("tomato")
    },
    { term: "salsa", preferredCategory: "Condiments & Sauces" },
    {
        term: "beer",
        preferredCategory: "Beer",
        condition: (query: string) => query.includes("non-alcoholic") || query.includes("non")
    },
    {
        term: "wine",
        preferredCategory: "Wine",
        condition: (query: string) => query.includes("non-alcoholic") || query.includes("non")
    },
    {
        term: "tomato",
        preferredCategory: "Dry Goods & Pasta",
        condition: (query: string) => query.includes("can")
    },
    { term: "tofu", preferredCategory: "Meat & Seafood" },
    {
        term: "dip",
        preferredCategory: "Deli",
        condition: (query: string) => query.includes("hummus") ||
            query.includes("guacamole") ||
            query.includes("cheese")
    },
    {
        term: "cocktail",
        preferredCategory: "Liquor",
        condition: (query: string) => query.includes("can")
    },
];


export const AMBIGUOUS_SINGLE_FOOD_TERMS = new Set([

    "apple", "apples",
    "apricot", "apricots",
    "avocado", "avocados",
    "banana", "bananas",
    "berry", "berries",
    "blueberry", "blueberries",
    "cantaloupe", "cantaloupes",
    "grape", "grapes",
    "grapefruit", "grapefruits",
    "honeydew", "honeydews",
    "kiwi", "kiwis",
    "lemon", "lemons",
    "lime", "limes",
    "mango", "mangos",
    "melon", "melons",
    "orange", "oranges",
    "peach", "peaches",
    "pear", "pears",
    "persimmon", "persimmons",
    "pineapple", "pineapples",
    "plum", "plums",
    "pomegranate", "pomegranates",
    "raspberry", "raspberries",
    "strawberry", "strawberries",
    "watermelon", "watermelons",


    "asparagus",
    "bean", "beans",
    "beet", "beets",
    "broccoli",
    "cabbage", "cabbages",
    "carrot", "carrots",
    "cauliflower",
    "celery",
    "corn",
    "cucumber", "cucumbers",
    "eggplant", "eggplants",
    "garlic",
    "gourd", "gourds",
    "kale",
    "lettuce", "lettuces",
    "mushroom", "mushrooms",
    "onion", "onions",
    "pea", "peas",
    "pepper", "peppers",
    "potato", "potatoes",
    "radish", "radishes",
    "spinach",
    "sprout", "sprouts",
    "squash", "squashes",
    "tomato", "tomatoes",
    "yam", "yams",


    "herb", "herbs",

    "bread",
    "butter",
    "cheese", "cheeses",
    "chicken",
    "cream",
    "egg", "eggs",
    "fish",
    "flour",
    "juice",
    "milk", "milks",
    "oil",
    "pasta",
    "rice",
    "salt",
    "soup", "soups",
    "spice", "spices",
    "sugar",
    "tea", "teas",
    "tuna",
    "turkey",
    "water",
    "yogurt", "yogurts",
    "beef",
    "pork",
    "sprite",
    "salmon"
]);
