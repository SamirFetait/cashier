import { createTheme, type MantineColorsTuple } from "@mantine/core";

/*
 * Palettes sampled from the logo, light (0) to dark (9). The logo's own
 * colours sit at fixed shades so they can be referenced directly:
 *
 *   teal   4 badge light teal · 5 badge teal
 *   gold   4 hexagon frame    · 6 the frame's orange end
 *   wood   3 ribbon sand      · 5 ribbon       · 8 Arabic lettering
 *   green  7 / 8 palm fronds (replaces Mantine's green, so success
 *          states use the palms)
 */
const teal: MantineColorsTuple = [
  "#e5fdf8", "#c3f2e9", "#9fe7da", "#77dccb", "#43d0bd",
  "#28bcb0", "#1aa094", "#0b8579", "#016158", "#013f39",
];

const gold: MantineColorsTuple = [
  "#fff6e2", "#fbe9c0", "#f6dc9f", "#f1cf7b", "#ecc152",
  "#ebac4c", "#e6984e", "#b47538", "#845324", "#573410",
];

const wood: MantineColorsTuple = [
  "#fff5ea", "#f6dcbe", "#eac396", "#ddab6e", "#cf985a",
  "#c18546", "#a86f38", "#8f5a2a", "#76461d", "#3e2005",
];

const green: MantineColorsTuple = [
  "#e9fded", "#c7eacd", "#a4d7ae", "#81c490", "#5bb172",
  "#2c9e54", "#1c8b46", "#087838", "#047036", "#003918",
];

/** The logo's sweep from badge teal through the frame gold to the ribbon. */
export const BRAND_GRADIENT =
  "linear-gradient(90deg, var(--mantine-color-teal-5), var(--mantine-color-gold-4) 55%, var(--mantine-color-wood-5))";

export const theme = createTheme({
  primaryColor: "teal",
  // Shade 7 is the first teal dark enough for white text (4.5:1), so filled
  // buttons stay legible; the brighter logo teal (5) is kept for accents.
  // In dark mode the same shade keeps buttons visible against the surface.
  primaryShade: { light: 7, dark: 7 },
  colors: { teal, gold, wood, green },
  defaultRadius: "md",
  defaultGradient: { from: "teal.5", to: "gold.4", deg: 90 },
});
