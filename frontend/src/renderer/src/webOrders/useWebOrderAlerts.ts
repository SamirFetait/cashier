/**
 * Tells whoever is at the till that a website order needs them: a popup and a
 * chime on any screen, for every user. Clicking the popup opens the order.
 *
 * It watches the shared board query, so it costs no extra requests.
 */
import { notifications } from "@mantine/notifications";
import { useEffect, useRef, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

import type { WebOrder, WebOrderStatus } from "../api/types";
import { useI18n, type Messages } from "../i18n";
import { money, needsStaff, useBoard } from "./api";

/** Two soft rising notes, made on the spot: no sound file to ship. */
function chime(): void {
  try {
    const context = new AudioContext();
    for (const [index, frequency] of [880, 1318].entries()) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.16;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.55);
    }
    window.setTimeout(() => void context.close(), 1200);
  } catch {
    /* no audio output */
  }
}

/** A click on the popup itself, not on its close button. */
function onBody(handler: () => void) {
  return (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    handler();
  };
}

function fulfilmentText(order: WebOrder, t: Messages): string {
  return order.fulfilment === "DELIVERY" ? t.webOrders.delivery : t.webOrders.pickup;
}

export function useWebOrderAlerts(): void {
  const board = useBoard();
  const navigate = useNavigate();
  const { t } = useI18n();
  // What each open order looked like at the last poll; null until the first.
  const seen = useRef<Map<number, WebOrderStatus> | null>(null);

  useEffect(() => {
    const data = board.data;
    if (!data) return;
    const previous = seen.current;
    seen.current = new Map(data.orders.map((order) => [order.id, order.status]));

    const open = (id: number, notificationId: string) => {
      notifications.hide(notificationId);
      navigate(`/web-orders?order=${id}`);
    };

    // Just signed in or started: one quiet summary of what is already waiting.
    if (!previous) {
      const waiting = data.orders.filter((order) => needsStaff(order.status));
      if (waiting.length > 0) {
        const id = "web-orders-waiting";
        notifications.show({
          id,
          color: "orange",
          title: t.nav.webOrders,
          message: waiting.map((order) => `${order.code} · ${t.webOrders.status[order.status]}`).join("\n"),
          autoClose: 12_000,
          style: { cursor: "pointer", whiteSpace: "pre-line" },
          onClick: onBody(() => {
            notifications.hide(id);
            navigate("/web-orders");
          }),
        });
      }
      return;
    }

    let ring = false;
    for (const order of data.orders) {
      const before = previous.get(order.id);
      if (order.status === "DEPOSIT_REVIEW" && before !== "DEPOSIT_REVIEW") {
        // A transfer to check (also an expired order revived by a late payer).
        const id = `web-order-${order.id}-review`;
        notifications.show({
          id,
          color: "orange",
          title: t.webOrders.alerts.depositReview(order.code),
          message: `${t.webOrders.alerts.depositReviewBody(order.customer_name, money(order.deposit_required, t))} ${t.webOrders.alerts.openIt}`,
          autoClose: false,
          style: { cursor: "pointer" },
          onClick: onBody(() => open(order.id, id)),
        });
        ring = true;
      } else if (before === undefined) {
        const id = `web-order-${order.id}-new`;
        notifications.show({
          id,
          color: "teal",
          title: t.webOrders.alerts.newOrder(order.code),
          message: `${t.webOrders.alerts.newOrderBody(order.customer_name, fulfilmentText(order, t), money(order.total, t))}. ${t.webOrders.alerts.openIt}`,
          autoClose: false,
          style: { cursor: "pointer" },
          onClick: onBody(() => open(order.id, id)),
        });
        ring = true;
      }
    }
    if (ring) chime();
    // Only a new answer from the server should alert; t and navigate are
    // read fresh when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.data]);
}
