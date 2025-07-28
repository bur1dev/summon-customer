// query-utils.ts

import { AMBIGUOUS_SINGLE_FOOD_TERMS, AMBIGUOUS_TERM_TYPE_HINTS } from './search-constants';

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