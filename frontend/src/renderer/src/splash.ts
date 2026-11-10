// The startup splash (splash.html). The main process reports each step over
// "update-status": checking for an update, downloading it, installing it (the
// app then restarts), or opening. It runs before the app, so it reads the
// saved language itself instead of loading the React app's i18n.
import type { UpdateStatus } from "../../shared/updates";
import { ar } from "./i18n/ar";
import { en } from "./i18n/en";
import { dirOf, storedLang } from "./i18n/lang";

const lang = storedLang();
document.documentElement.lang = lang;
document.documentElement.dir = dirOf(lang);
const text = (lang === "ar" ? ar : en).splash;

const el = (id: string) => document.getElementById(id)!;
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

function render(status: UpdateStatus): void {
  const state = status.state in text ? (status.state as keyof typeof text) : "starting";
  const entry = text[state];
  el("title").textContent = entry.title;
  el("sub").textContent = typeof entry.sub === "function" ? entry.sub(status.version ?? "") : entry.sub;
  el("status").classList.toggle("error", state === "error");

  const determinate = state === "downloading";
  el("track").classList.toggle("indeterminate", !determinate && state !== "error" && state !== "opening");
  el("fill").classList.toggle("done", state === "installing" || state === "opening");
  if (determinate) {
    const pct = Math.max(0, Math.min(100, Math.round(status.percent ?? 0)));
    el("fill").style.width = `${pct}%`;
    el("track").setAttribute("aria-valuenow", String(pct));
    el("pct").textContent = `${pct}%`;
    el("size").textContent =
      status.total ? `${mb(status.transferred ?? 0)} / ${mb(status.total)} MB` : "";
  } else {
    el("fill").style.width = state === "error" ? "0" : state === "opening" ? "100%" : "";
    el("track").removeAttribute("aria-valuenow");
    el("pct").textContent = "";
    el("size").textContent = "";
  }
}

render({ state: "starting" });
window.api?.app.onUpdateStatus(render);
window.api?.app
  .version()
  .then((version) => {
    el("version").textContent = `v${version}`;
  })
  .catch(() => {});
