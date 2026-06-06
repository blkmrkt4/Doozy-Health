import type { FieldType } from "@/lib/types";

// Curated diary-field library (PRD §5.9). A static catalog the user picks from a
// list (one per line) and adds; no LLM. American English. `group` is a display
// header only. Each chosen preset becomes a tracked_fields row.

export type DiaryPreset = {
  name: string;
  field_type: FieldType;
  group: string;
  unit?: string;
  category_options?: string[];
};

export const DIARY_PRESETS: DiaryPreset[] = [
  // Mood & mind
  { group: "Mood & mind", name: "Mood", field_type: "scale_1_10" },
  { group: "Mood & mind", name: "Anxiety", field_type: "scale_1_10" },
  { group: "Mood & mind", name: "Irritability", field_type: "scale_1_10" },
  { group: "Mood & mind", name: "Focus", field_type: "scale_1_10" },
  { group: "Mood & mind", name: "Motivation", field_type: "scale_1_10" },
  { group: "Mood & mind", name: "Stress", field_type: "scale_1_10" },

  // Sleep
  { group: "Sleep", name: "Sleep", field_type: "number", unit: "hours" },
  { group: "Sleep", name: "Sleep quality", field_type: "scale_1_10" },
  { group: "Sleep", name: "Woke during the night", field_type: "boolean" },

  // Energy & physical
  { group: "Energy & physical", name: "Energy", field_type: "scale_1_10" },
  { group: "Energy & physical", name: "Fatigue", field_type: "scale_1_10" },
  { group: "Energy & physical", name: "Physical performance", field_type: "scale_1_10" },
  { group: "Energy & physical", name: "Exercised", field_type: "boolean" },
  { group: "Energy & physical", name: "Steps", field_type: "number" },

  // Sexual health
  { group: "Sexual health", name: "Libido", field_type: "scale_1_10" },
  { group: "Sexual health", name: "Erection quality", field_type: "scale_1_10" },
  { group: "Sexual health", name: "Morning erections", field_type: "boolean" },

  // Vitals
  { group: "Vitals", name: "Weight", field_type: "number", unit: "lb" },
  { group: "Vitals", name: "Resting heart rate", field_type: "number", unit: "bpm" },
  { group: "Vitals", name: "Blood pressure", field_type: "freetext" },
  { group: "Vitals", name: "Body temperature", field_type: "number", unit: "°F" },

  // Symptoms
  { group: "Symptoms", name: "Pain", field_type: "scale_1_10" },
  { group: "Symptoms", name: "Pain location", field_type: "freetext" },
  { group: "Symptoms", name: "Headache", field_type: "boolean" },
  { group: "Symptoms", name: "Nausea", field_type: "boolean" },
  { group: "Symptoms", name: "Swelling", field_type: "boolean" },
  { group: "Symptoms", name: "Hot flashes", field_type: "boolean" },
  { group: "Symptoms", name: "Night sweats", field_type: "boolean" },
  {
    group: "Symptoms",
    name: "Side effects",
    field_type: "multiselect",
    category_options: [
      "Nausea",
      "Headache",
      "Insomnia",
      "Fatigue",
      "Racing heart",
      "Jumpiness",
      "Night sweats",
      "Dry mouth",
      "Swelling",
      "Acid indigestion",
      "Achy joints",
      "Muscular soreness",
      "Tendinitis",
      "Sore breasts",
    ],
  },
  {
    group: "Symptoms",
    name: "Cold / heat tolerance",
    field_type: "category",
    category_options: ["Poor", "Okay", "Good"],
  },

  // Lifestyle
  { group: "Lifestyle", name: "Alcohol", field_type: "number", unit: "drinks" },
  { group: "Lifestyle", name: "Caffeine", field_type: "number", unit: "cups" },
  { group: "Lifestyle", name: "Water", field_type: "number", unit: "cups" },
  { group: "Lifestyle", name: "Diet quality", field_type: "scale_1_10" },

  // General
  { group: "General", name: "Notes", field_type: "freetext" },
];
