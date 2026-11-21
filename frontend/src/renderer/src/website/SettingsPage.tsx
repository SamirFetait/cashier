/** The website's settings: ordering, InstaPay, the deposit, delivery and
 * pickup, WhatsApp order alerts, the shop's details on the website, and its
 * games and the prizes a good score wins. */
import {
  Alert,
  Button,
  Card,
  FileButton,
  Group,
  Image,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCircleCheck, IconCircleX, IconDeviceFloppy, IconUpload } from "@tabler/icons-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";

import { api } from "../api/client";
import { ltr, useI18n } from "../i18n";
import { money, serverUrl } from "../webOrders/api";
import {
  fieldErrors,
  useQrUpload,
  useSaveWebsiteSettings,
  useWebsiteHealth,
  useWebsiteSettings,
  websiteErrorText,
  type WebsiteHealth,
  type WebsiteSettings,
} from "./api";
import { PageHead } from "./ui";

type Draft = Omit<WebsiteSettings, "instapay_qr_image" | "instapay_ready" | "updated_at" | "updated_by" | "free_delivery_over"> & {
  free_delivery_over: string;
};

function toDraft(settings: WebsiteSettings): Draft {
  const { instapay_qr_image: _q, instapay_ready: _r, updated_at: _u, updated_by: _b, ...draft } = settings;
  return { ...draft, free_delivery_over: draft.free_delivery_over ?? "" };
}

/** Each game's switch, the score that wins it, and what that score counts. */
const GAMES: ReadonlyArray<{
  name: "pushUps" | "memory" | "quiz" | "hungry";
  on: "push_ups_on" | "memory_on" | "calorie_challenge_on" | "hungry_bee_on";
  toWin: "push_ups_to_win" | "memory_stars_to_win" | "quiz_to_win" | "hungry_bee_to_win";
  counts: "pushUpsToWin" | "memoryToWin" | "quizToWin" | "hungryToWin";
}> = [
  { name: "pushUps", on: "push_ups_on", toWin: "push_ups_to_win", counts: "pushUpsToWin" },
  { name: "memory", on: "memory_on", toWin: "memory_stars_to_win", counts: "memoryToWin" },
  { name: "quiz", on: "calorie_challenge_on", toWin: "quiz_to_win", counts: "quizToWin" },
  { name: "hungry", on: "hungry_bee_on", toWin: "hungry_bee_to_win", counts: "hungryToWin" },
];

export function SettingsPage() {
  const { t } = useI18n();
  const s = t.website.settings;
  const settings = useWebsiteSettings();
  const save = useSaveWebsiteSettings();
  const qr = useQrUpload();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings.data && draft === null) setDraft(toDraft(settings.data));
  }, [settings.data, draft]);

  if (settings.isError) return <Alert color="red">{websiteErrorText(settings.error, t)}</Alert>;
  if (!settings.data || !draft) return <Skeleton h={480} />;
  const current = settings.data;
  const form = draft;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
  }

  function submit() {
    setErrors({});
    save.mutate(
      { ...form, free_delivery_over: form.free_delivery_over || null },
      {
        onSuccess: (saved) => {
          setDraft(toDraft(saved));
          notifications.show({ color: "green", message: t.website.saved });
        },
        onError: (error) => {
          setErrors(fieldErrors(error));
          notifications.show({ color: "red", message: websiteErrorText(error, t) });
        },
      }
    );
  }

  function uploadQr(file: File | null) {
    qr.mutate(file, { onError: (error) => notifications.show({ color: "red", message: websiteErrorText(error, t) }) });
  }

  const text = (key: keyof Draft, label: string, extra: { hint?: string; dir?: "ltr" | "rtl" } = {}) => (
    <TextInput
      label={label}
      description={extra.hint}
      dir={extra.dir}
      value={String(form[key] ?? "")}
      error={errors[key]}
      onChange={(e) => set(key, e.currentTarget.value as never)}
    />
  );

  // Kept as typed, so "12.50" reaches the server as it was written.
  const number = (key: keyof Draft, label: string, hint?: string) => (
    <TextInput
      label={label}
      description={hint}
      inputMode="decimal"
      dir="ltr"
      value={String(form[key] ?? "")}
      error={errors[key]}
      onChange={(e) => {
        const value = e.currentTarget.value;
        set(key, (typeof current[key as keyof WebsiteSettings] === "number" ? Number(value) || 0 : value) as never);
      }}
    />
  );

  const saveButton = (
    <Button leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} onClick={submit}>
      {t.common.save}
    </Button>
  );

  // The prize's terms in a sentence: the goods that can use one, and those
  // from which it takes its most (its share is in whole pounds, rounded down).
  const prizePercent = Number(form.prize_percent);
  const prizeMax = Number(form.prize_max);
  const prizeMin = Number(form.prize_min_order);
  const fullFrom = prizePercent > 0 ? Math.ceil((Math.ceil(prizeMax) * 100) / prizePercent) : 0;
  const prizeTerms =
    prizePercent > 0 && prizeMax > 0
      ? `${s.prizeUse(prizeMin > 0 ? money(prizeMin, t) : null)} ${s.prizeFull(
          money(prizeMax, t),
          fullFrom > prizeMin ? money(fullFrom, t) : null
        )}`
      : null;

  return (
    <>
      <PageHead title={t.website.nav.settings}>{saveButton}</PageHead>

      <Section title={s.health}>
        <HealthList />
      </Section>

      <Section title={s.ordering}>
        <Switch
          label={s.orderingOn}
          description={s.orderingHint}
          checked={form.ordering_enabled}
          onChange={(e) => set("ordering_enabled", e.currentTarget.checked)}
        />
      </Section>

      <Section title={s.instapay} intro={s.instapayHint}>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
          <Stack>
            {text("instapay_address", s.address, { dir: "ltr" })}
            {text("instapay_name", s.accountName)}
            {text("instapay_mobile", s.mobile, { dir: "ltr" })}
            {text("instapay_link", s.link, { dir: "ltr", hint: s.linkHint })}
          </Stack>
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              {s.preview}
            </Text>
            {current.instapay_qr_image ? (
              <Image src={serverUrl(current.instapay_qr_image)} alt="" w={180} h={180} fit="contain" radius="md" bg="white" />
            ) : (
              <Text size="sm" c="dimmed">
                {form.instapay_link ? s.drawnFromLink : s.noCode}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              {s.qrHint}
            </Text>
            <Group gap="xs">
              <FileButton onChange={uploadQr} accept="image/png,image/jpeg,image/webp">
                {(props) => (
                  <Button {...props} size="xs" variant="light" leftSection={<IconUpload size={14} />} loading={qr.isPending}>
                    {s.uploadQr}
                  </Button>
                )}
              </FileButton>
              {current.instapay_qr_image && (
                <Button size="xs" variant="subtle" color="red" onClick={() => uploadQr(null)}>
                  {s.removeQr}
                </Button>
              )}
            </Group>
          </Stack>
        </SimpleGrid>
      </Section>

      <Section title={s.deposit}>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {number("deposit_percent", s.percent)}
          {number("deposit_min", s.min)}
          {number("hold_minutes", s.hold, s.holdHint)}
        </SimpleGrid>
      </Section>

      <Section title={s.fulfilment}>
        <Group gap="xl">
          <Switch
            label={s.deliveryOn}
            checked={form.delivery_enabled}
            onChange={(e) => set("delivery_enabled", e.currentTarget.checked)}
          />
          <Switch
            label={s.pickupOn}
            checked={form.pickup_enabled}
            onChange={(e) => set("pickup_enabled", e.currentTarget.checked)}
          />
        </Group>
        {errors.pickup_enabled && <Alert color="red">{errors.pickup_enabled}</Alert>}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {number("delivery_fee", s.fee)}
          {number("free_delivery_over", s.freeOver, s.freeOverHint)}
          {number("min_order", s.minOrder)}
        </SimpleGrid>
      </Section>

      <Section title={s.alerts}>
        <Switch
          label={s.alertsOn}
          description={s.alertsHint}
          checked={form.whatsapp_alerts}
          onChange={(e) => set("whatsapp_alerts", e.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {text("alert_whatsapp", s.alertNumber, { dir: "ltr", hint: s.alertNumberHint })}
        </SimpleGrid>
      </Section>

      <Section title={s.store}>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {text("whatsapp", s.whatsapp, { dir: "ltr" })}
          <span />
          {text("address_ar", s.addressAr, { dir: "rtl" })}
          {text("address_en", s.addressEn, { dir: "ltr" })}
          {text("hours_ar", s.hoursAr, { dir: "rtl" })}
          {text("hours_en", s.hoursEn, { dir: "ltr" })}
          {text("delivery_note_ar", s.noteAr, { dir: "rtl" })}
          {text("delivery_note_en", s.noteEn, { dir: "ltr" })}
          {text("announcement_ar", s.announceAr, { dir: "rtl" })}
          {text("announcement_en", s.announceEn, { dir: "ltr" })}
        </SimpleGrid>
      </Section>

      <Section title={s.games} intro={s.gamesHint}>
        <Group gap="xl">
          {GAMES.map((game) => (
            <Switch
              key={game.on}
              label={s.game[game.name]}
              checked={form[game.on]}
              onChange={(e) => set(game.on, e.currentTarget.checked)}
            />
          ))}
        </Group>
      </Section>

      <Section title={s.prizes}>
        <Switch
          label={s.prizesOn}
          description={s.prizesHint}
          checked={form.prizes_enabled}
          onChange={(e) => set("prizes_enabled", e.currentTarget.checked)}
        />
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {number("prize_percent", s.prizePercent)}
          {number("prize_max", s.prizeMax)}
          {number("prize_min_order", s.prizeMinOrder)}
        </SimpleGrid>
        {prizeTerms && (
          <Text size="sm" c="dimmed">
            {prizeTerms}
          </Text>
        )}
        <Title order={5}>{s.toWin}</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {GAMES.map((game) => (
            <Fragment key={game.toWin}>{number(game.toWin, s.game[game.name], s[game.counts])}</Fragment>
          ))}
        </SimpleGrid>
      </Section>

      <Group justify="flex-end">{saveButton}</Group>
    </>
  );
}

function Section({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <Card withBorder radius="md" p="lg">
      <Stack>
        <div>
          <Title order={4}>{title}</Title>
          {intro && (
            <Text size="sm" c="dimmed">
              {intro}
            </Text>
          )}
        </div>
        {children}
      </Stack>
    </Card>
  );
}

/** What the server says about the setup: is everything the website needs there? */
function HealthList() {
  const { t } = useI18n();
  const s = t.website.settings;
  const health = useWebsiteHealth();
  if (health.isError) return <Alert color="red">{websiteErrorText(health.error, t)}</Alert>;
  if (!health.data) return <Skeleton h={96} />;
  const data = health.data;
  return (
    <Stack gap="xs">
      <Check ok label={s.server} detail={`${ltr(new URL(api.defaults.baseURL ?? "", window.location.href).origin)} · ${s.products(data.products)}`} />
      <Check ok={data.storage.ok} label={s.storage} detail={data.storage.ok ? data.storage.name : s.noStorage} />
      <Check ok={Boolean(data.site_url)} label={s.siteUrl} detail={data.site_url ? ltr(data.site_url) : "—"} />
      {data.whatsapp && <AlertsCheck whatsapp={data.whatsapp} />}
    </Stack>
  );
}

/** Whether the server's WhatsApp order alerts will actually ring a phone. */
function AlertsCheck({ whatsapp }: { whatsapp: NonNullable<WebsiteHealth["whatsapp"]> }) {
  const { t } = useI18n();
  const s = t.website.settings;
  const ok = whatsapp.alerts && whatsapp.connected && !whatsapp.same_number;
  const cloud = whatsapp.provider === "cloud";
  let detail: string;
  if (!whatsapp.alerts) detail = s.alertsOff;
  else if (!whatsapp.connected) detail = cloud ? s.alertsCloudDown(whatsapp.error) : s.alertsDown;
  else if (whatsapp.same_number) detail = cloud ? s.alertsCloudSelf : s.alertsSelf;
  else if (cloud) detail = s.alertsCloudRoute(whatsapp.from, whatsapp.to);
  else detail = s.alertsRoute(whatsapp.from, whatsapp.to);
  return <Check ok={ok || !whatsapp.alerts} label={s.alerts} detail={detail} />;
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <Group gap="sm" wrap="nowrap" align="flex-start">
      <Text c={ok ? "green" : "red"} lh={0} mt={2}>
        {ok ? <IconCircleCheck size={18} /> : <IconCircleX size={18} />}
      </Text>
      <Text size="sm" fw={600} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="sm" c="dimmed">
        {detail}
      </Text>
    </Group>
  );
}
