import { Avatar } from "@mantine/core";
import { IconPhoto } from "@tabler/icons-react";

/**
 * The small version of a product photo. The API hands out full-size URLs;
 * the same URL with size=thumb is the ~320px copy, plenty for lists.
 */
export function productThumbUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const url = new URL(imageUrl);
  url.searchParams.set("size", "thumb");
  return url.toString();
}

/**
 * A product photo square, or a placeholder when there is none (or it cannot
 * load, e.g. while the till is offline). Contained, not cropped, so the whole
 * product stays visible.
 */
export function ProductThumb({ src, size = 36 }: { src: string | null | undefined; size?: number }) {
  return (
    <Avatar
      src={src || null}
      alt=""
      size={size}
      radius="sm"
      color="gray"
      styles={{ image: { objectFit: "contain" } }}
    >
      <IconPhoto size={Math.round(size / 2)} stroke={1.5} />
    </Avatar>
  );
}
