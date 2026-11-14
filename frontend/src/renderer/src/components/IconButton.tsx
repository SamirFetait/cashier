import {
  ActionIcon,
  Tooltip,
  type ActionIconProps,
  type ElementProps,
  type TooltipProps,
} from "@mantine/core";

interface IconButtonProps extends ActionIconProps, ElementProps<"button", keyof ActionIconProps> {
  /** What the button does, e.g. "Edit product". */
  label: string;
  tooltipPosition?: TooltipProps["position"];
}

/**
 * A button that shows only an icon. Its label, which it cannot be without,
 * does what the missing words would: it is the tooltip on hover and the
 * button's name for screen readers (aria-label).
 */
export function IconButton({ label, tooltipPosition, ...props }: IconButtonProps) {
  return (
    <Tooltip label={label} position={tooltipPosition} withArrow>
      <ActionIcon {...props} aria-label={label} />
    </Tooltip>
  );
}
