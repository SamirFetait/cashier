/**
 * The custom window title bar, shared by the main process and the renderer.
 *
 * On Windows the app has no system title bar or menu: the renderer draws a
 * bar of TITLEBAR_HEIGHT at the top of every screen, and Windows draws its
 * own minimize / maximize / close buttons over the bar's right end, in these
 * colours (the renderer re-sends them when the colour scheme changes).
 */
export const TITLEBAR_HEIGHT = 36;

/** Room the window buttons take at the bar's right end. */
export const TITLEBAR_BUTTONS_WIDTH = 140;

export interface TitleBarColors {
  /** Bar background. */
  color: string;
  /** Window button glyphs. */
  symbolColor: string;
}

export const TITLEBAR_COLORS: Record<"light" | "dark", TitleBarColors> = {
  light: { color: "#016158", symbolColor: "#ffffff" }, // brand teal (shade 8)
  dark: { color: "#0b1f1d", symbolColor: "#d3f1ec" },
};
