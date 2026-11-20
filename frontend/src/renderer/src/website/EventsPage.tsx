/** Events on the website: a card per event, and one dialog to write an event
 * and manage its photos and short videos (add, order, remove). */
import {
  Alert,
  AspectRatio,
  Badge,
  Box,
  Button,
  Card,
  Center,
  FileButton,
  Group,
  Image,
  Modal,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCalendarEvent,
  IconChevronLeft,
  IconChevronRight,
  IconEdit,
  IconMapPin,
  IconPhotoPlus,
  IconPlayerPlayFilled,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "../components/IconButton";
import { useI18n } from "../i18n";
import { serverUrl } from "../webOrders/api";
import {
  fieldErrors,
  readVideo,
  useEventMutations,
  useEvents,
  websiteErrorText,
  type WebsiteEvent,
} from "./api";
import { EmptyState, HexIcon, PageHead, useConfirm } from "./ui";

const MAX_MEDIA = 20;

/** "2026-11-21T18:00" for a datetime-local box, in this computer's time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

export function EventsPage() {
  const { t, formatDateTime } = useI18n();
  const e = t.website.events;
  const events = useEvents();
  // null: closed; 0: a new event; otherwise the event being edited.
  const [editing, setEditing] = useState<number | null>(null);
  const list = events.data?.events ?? [];

  return (
    <>
      <PageHead title={t.website.nav.events} intro={e.intro}>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(0)}>
          {e.add}
        </Button>
      </PageHead>
      {events.isError && <Alert color="red">{websiteErrorText(events.error, t)}</Alert>}
      {events.isPending && <Skeleton h={240} />}
      {events.data && list.length === 0 && <EmptyState icon={<IconCalendarEvent size={30} />} title={e.none} />}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {list.map((event) => {
          const photos = event.media.filter((m) => m.kind === "PHOTO").length;
          return (
            <Card key={event.id} withBorder radius="md" opacity={event.is_published ? 1 : 0.6}>
              <Card.Section>
                <AspectRatio ratio={16 / 9} bg="var(--mantine-color-gold-light)">
                  {event.cover ? (
                    <Image src={serverUrl(event.cover)} alt="" fit="cover" />
                  ) : (
                    <Center>
                      <HexIcon size={64}>
                        <IconCalendarEvent size={28} />
                      </HexIcon>
                    </Center>
                  )}
                </AspectRatio>
              </Card.Section>
              <Stack gap={4} mt="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Badge variant="light" color={event.is_published ? "green" : "gray"}>
                    {event.is_published ? e.live : e.draft}
                  </Badge>
                  <Button size="compact-sm" variant="light" leftSection={<IconEdit size={14} />} onClick={() => setEditing(event.id)}>
                    {t.website.catalogue.edit}
                  </Button>
                </Group>
                <Text fw={600}>{event.title}</Text>
                <Group gap={6} wrap="nowrap">
                  <IconCalendarEvent size={14} />
                  <Text size="sm" c="dimmed">
                    {formatDateTime(event.starts_at)}
                  </Text>
                </Group>
                <Group gap={6} wrap="nowrap">
                  <IconMapPin size={14} />
                  <Text size="sm" c="dimmed">
                    {event.place || e.atShop}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  {e.counts(photos, event.media.length - photos)}
                </Text>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
      <EventDialog
        opened={editing !== null}
        event={editing ? (list.find((item) => item.id === editing) ?? null) : null}
        maxMb={events.data?.max_mb ?? 80}
        onCreated={setEditing}
        onClose={() => setEditing(null)}
      />
    </>
  );
}

function EventDialog({
  opened,
  event,
  maxMb,
  onCreated,
  onClose,
}: {
  opened: boolean;
  /** null while writing a new one. */
  event: WebsiteEvent | null;
  maxMb: number;
  onCreated: (id: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const e = t.website.events;
  const { create, update, remove } = useEventMutations();
  const confirm = useConfirm();
  const [title, setTitle] = useState("");
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [place, setPlace] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = create.isPending || update.isPending || remove.isPending;

  // Filled when the dialog opens on an event (or empty for a new one), not on
  // every refresh, so typing is never overwritten.
  const loadedFor = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (!opened) {
      loadedFor.current = undefined;
      return;
    }
    const id = event?.id ?? null;
    if (loadedFor.current === id) return;
    loadedFor.current = id;
    setTitle(event?.title ?? "");
    setStarts(toLocalInput(event?.starts_at ?? null));
    setEnds(toLocalInput(event?.ends_at ?? null));
    setPlace(event?.place ?? "");
    setDescription(event?.description ?? "");
    setPublished(event?.is_published ?? true);
    setErrors({});
  }, [opened, event]);

  const failed = (error: unknown) => {
    setErrors(fieldErrors(error));
    notifications.show({ color: "red", message: websiteErrorText(error, t) });
  };

  function submit() {
    setErrors({});
    const body = {
      title: title.trim(),
      description,
      starts_at: fromLocalInput(starts) ?? undefined,
      ends_at: fromLocalInput(ends),
      place: place.trim(),
      is_published: published,
    };
    if (event) {
      update.mutate(
        { id: event.id, body },
        {
          onSuccess: () => {
            notifications.show({ color: "green", message: t.website.saved });
            onClose();
          },
          onError: failed,
        }
      );
    } else {
      create.mutate(body, {
        onSuccess: (created) => {
          // Stay open on it, so its photos can be added next.
          loadedFor.current = created.id;
          onCreated(created.id);
          notifications.show({ color: "green", message: t.website.saved });
        },
        onError: failed,
      });
    }
  }

  async function deleteEvent() {
    if (!event || !(await confirm.ask(e.deleteConfirm, e.delete))) return;
    remove.mutate(event.id, { onSuccess: onClose, onError: failed });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={event ? e.edit : e.newTitle}
      size="xl"
      closeOnClickOutside={!busy}
    >
      <Stack>
        <TextInput
          label={e.title}
          placeholder={e.titlePlaceholder}
          required
          maxLength={160}
          value={title}
          error={errors.title}
          onChange={(ev) => setTitle(ev.currentTarget.value)}
        />
        <Group grow align="flex-end">
          <TextInput
            type="datetime-local"
            label={e.starts}
            required
            value={starts}
            error={errors.starts_at}
            onChange={(ev) => setStarts(ev.currentTarget.value)}
          />
          <TextInput
            type="datetime-local"
            label={e.ends}
            description={e.endsHint}
            min={starts || undefined}
            value={ends}
            error={errors.ends_at}
            onChange={(ev) => setEnds(ev.currentTarget.value)}
          />
        </Group>
        <TextInput
          label={e.place}
          description={e.placeHint}
          maxLength={200}
          value={place}
          error={errors.place}
          onChange={(ev) => setPlace(ev.currentTarget.value)}
        />
        <Textarea
          label={e.description}
          description={t.website.optional}
          placeholder={e.descriptionPlaceholder}
          maxLength={2000}
          autosize
          minRows={4}
          value={description}
          error={errors.description}
          onChange={(ev) => setDescription(ev.currentTarget.value)}
        />
        <Switch label={e.published} checked={published} onChange={(ev) => setPublished(ev.currentTarget.checked)} />
        {event && <MediaManager event={event} maxMb={maxMb} />}
        <Group justify="space-between">
          {event ? (
            <Button
              variant="subtle"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => void deleteEvent()}
              disabled={busy}
            >
              {e.delete}
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={submit} loading={create.isPending || update.isPending} disabled={!title.trim() || !starts}>
            {event ? t.common.save : e.create}
          </Button>
        </Group>
      </Stack>
      {confirm.dialog}
    </Modal>
  );
}

/** The event's photos and videos: add several at once, move, remove. */
function MediaManager({ event, maxMb }: { event: WebsiteEvent; maxMb: number }) {
  const { t } = useI18n();
  const e = t.website.events;
  const { addMedia, reorder, removeMedia } = useEventMutations();
  const confirm = useConfirm();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const media = event.media;
  const room = MAX_MEDIA - media.length;
  const failed = (error: unknown) => notifications.show({ color: "red", message: websiteErrorText(error, t) });

  async function upload(files: File[]) {
    const chosen = files.slice(0, room);
    if (chosen.length === 0) return;
    for (const [index, file] of chosen.entries()) {
      setProgress({ done: index + 1, total: chosen.length });
      const form = new FormData();
      form.append("file", file);
      if (file.type.startsWith("video/")) {
        if (file.size > maxMb * 1024 * 1024) {
          notifications.show({ color: "red", message: e.tooLarge(file.name) });
          continue;
        }
        // The poster frame and size come from here, as for the website's videos.
        const meta = await readVideo(file);
        if (meta?.poster) form.append("poster", meta.poster, "poster.jpg");
        if (meta?.duration) form.append("duration", String(meta.duration));
        if (meta?.width) form.append("width", String(meta.width));
        if (meta?.height) form.append("height", String(meta.height));
      }
      try {
        await addMedia.mutateAsync({ id: event.id, form });
      } catch (error) {
        notifications.show({ color: "red", message: `${file.name}: ${websiteErrorText(error, t)}` });
      }
    }
    setProgress(null);
  }

  function move(index: number, by: number) {
    const ids = media.map((item) => item.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    reorder.mutate({ id: event.id, ids }, { onError: failed });
  }

  async function drop(mediaId: number) {
    if (await confirm.ask(e.removeMediaConfirm, e.removeMedia)) {
      removeMedia.mutate({ id: event.id, mediaId }, { onError: failed });
    }
  }

  return (
    <Stack gap="xs">
      <Title order={4}>{e.media}</Title>
      <Text size="xs" c="dimmed">
        {e.mediaHint(MAX_MEDIA, maxMb)}
      </Text>
      {media.length === 0 && (
        <Text size="sm" c="dimmed">
          {e.noMedia}
        </Text>
      )}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {media.map((item, index) => (
          <Card key={item.id} withBorder radius="md" p={4}>
            <AspectRatio ratio={1} bg="dark.9" style={{ borderRadius: 6, overflow: "hidden" }}>
              {item.kind === "PHOTO" ? (
                <Image src={serverUrl(item.src)} alt="" fit="cover" />
              ) : (
                <Box pos="relative">
                  {item.poster ? (
                    <Image src={serverUrl(item.poster)} alt="" fit="cover" h="100%" />
                  ) : (
                    <video src={`${serverUrl(item.src)}#t=0.1`} preload="metadata" muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <Center pos="absolute" inset={0} c="white">
                    <IconPlayerPlayFilled size={28} />
                  </Center>
                </Box>
              )}
            </AspectRatio>
            <Group justify="space-between" gap={0} mt={4} wrap="nowrap">
              <IconButton
                label={e.earlier}
                size="sm"
                variant="subtle"
                disabled={index === 0 || reorder.isPending}
                onClick={() => move(index, -1)}
              >
                <IconChevronLeft size={16} className="mantine-rotate-rtl" />
              </IconButton>
              <IconButton
                label={e.removeMedia}
                size="sm"
                variant="subtle"
                color="red"
                disabled={removeMedia.isPending}
                onClick={() => void drop(item.id)}
              >
                <IconTrash size={15} />
              </IconButton>
              <IconButton
                label={e.later}
                size="sm"
                variant="subtle"
                disabled={index === media.length - 1 || reorder.isPending}
                onClick={() => move(index, 1)}
              >
                <IconChevronRight size={16} className="mantine-rotate-rtl" />
              </IconButton>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
      {progress ? (
        <Text size="sm" c="dimmed" aria-live="polite">
          {e.uploading(progress.done, progress.total)}
        </Text>
      ) : (
        room > 0 && (
          <FileButton
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime"
            onChange={(files) => void upload(files)}
          >
            {(props) => (
              <Button {...props} variant="light" leftSection={<IconPhotoPlus size={16} />} style={{ alignSelf: "flex-start" }}>
                {e.addMedia}
              </Button>
            )}
          </FileButton>
        )
      )}
      {confirm.dialog}
    </Stack>
  );
}
