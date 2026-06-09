// Canonical pill catalogs. Single source of truth for both the home-page
// filter bar and (soon) the recipe-detail edit UI — keeping them aligned
// here prevents the two views from drifting apart as we evolve.
//
// Enums (course, season) come from CHECK constraints in the DB schema.
// Free-text catalogs (cuisine, holiday, tags) are computed from observed
// data via getFilterFacets() in queries.ts.

import type { Course, Season } from "./types";

export const COURSES: Course[] = [
  "breakfast",
  "lunch",
  "dinner",
  "appetizer",
  "side",
  "snack",
  "dessert",
  "drink",
];

// Meal-intent grouping for the home-page sections. Tweak weights or which
// section a course belongs to from here.
export const MAIN_COURSES: Course[] = ["breakfast", "lunch", "dinner"];
export const TREAT_COURSES: Course[] = [
  "dessert",
  "snack",
  "drink",
  "side",
  "appetizer",
];

export const SEASONS: Season[] = ["spring", "summer", "fall", "winter"];

// Returns the seasons relevant to the current month using NE-US growing
// seasons with overlapping shoulder months (May/Jun, Aug/Sep, Nov/Feb), so
// the season filter feels natural in transition periods rather than
// snapping hard on the 1st of each month.
export function currentSeasonWindow(date = new Date()): Season[] {
  const month = date.getMonth() + 1; // 1–12
  switch (month) {
    case 1:
    case 2:
      return ["winter"];
    case 3:
      return ["winter", "spring"];
    case 4:
      return ["spring"];
    case 5:
    case 6:
      return ["spring", "summer"];
    case 7:
      return ["summer"];
    case 8:
    case 9:
      return ["summer", "fall"];
    case 10:
      return ["fall"];
    case 11:
      return ["fall", "winter"];
    case 12:
      return ["winter"];
    default:
      return [];
  }
}

// Curated diet-tag allowlist. Tags on recipes that intersect this set get
// surfaced under the "Diet" section of the "More" filter sheet; everything
// else lands in the generic "Tags" section. Values are the canonical forms
// produced by migration 0032 — lowercase, hyphenated. Keep in sync with
// the diet branch of the CASE in that migration.
export const DIET_TAGS = [
  "vegan",
  "vegetarian",
  "gluten-free",
  "dairy-free",
  "keto",
  "low-carb",
  "paleo",
  "whole30",
  "kosher",
  "nut-free",
  "plant-based",
  "grain-free",
  "high-protein",
];
