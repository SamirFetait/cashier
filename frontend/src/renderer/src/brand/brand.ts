/**
 * Store identity: the one place to change the name or contact number.
 *
 * Related brand pieces live elsewhere because their formats demand it:
 *   colours           ./theme.ts
 *   artwork           ../assets/brand/ (derived from the master logo)
 *   window title      ../../index.html and src/main/index.ts
 *   installer + icon  electron-builder.yml and build/icon.*
 */
const WHATSAPP = "+20 15 53211120";

export const BRAND = {
  name: "Fathet Kheer",
  nameAr: "فاتحة خير",
  whatsapp: {
    display: WHATSAPP,
    /** Click-to-chat link; wa.me takes the number as bare digits. */
    link: `https://wa.me/${WHATSAPP.replace(/\D/g, "")}`,
  },
} as const;
