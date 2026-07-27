# Envy — User Guide

Everything you can do in Envy, screen by screen.

## Contents
- [First run: enabling URLs](#first-run-enabling-urls)
- [Services](#services)
- [Running a new container](#running-a-new-container)
- [The Inspect drawer](#the-inspect-drawer)
- [Images](#images)
- [Domains](#domains)
- [Activity](#activity)
- [When Docker isn’t running](#when-docker-isnt-running)
- [Themes](#themes)
- [How URLs are assigned (the mental model)](#how-urls-are-assigned-the-mental-model)

---

## First run: enabling URLs

Envy can *list and control* containers as soon as a Docker engine is running.
To actually **serve** `https://…` URLs, it needs a small privileged background
service (the daemon).

1. In the header, click **“⚡ Enable URLs.”**
2. Approve the **one** native macOS password prompt.

That installs a background service which:
- runs a tiny DNS server for your domains,
- runs a reverse proxy on ports 80/443,
- trusts a local Certificate Authority so HTTPS shows a green lock,
- starts automatically on every reboot.

The header pill then reads **“URLs live.”** To remove it later, click the
**⏻** power button in the pill (one prompt).

> You only do this once. After that, adding domains or reassigning containers
> takes effect live — no more prompts.

---

## Services

The home screen. Containers are **grouped by Docker Compose project**; a
standalone bucket holds anything not in a project.

**Group header:**
- Collapse/expand caret (your choice is remembered).
- A running‑count badge (e.g. `6/9`).
- **Start all / Stop all** for the whole project.

**Each service card shows:**
- A status dot — **pulsing green** when running, dim when stopped.
- The service name (short Compose name inside a group).
- **The URL(s)** — the hero of the card. Click a URL to open it in your
  browser; click the copy icon to copy it. A `local`/`custom` tag marks
  whether it’s a default domain or a custom hostname.
- A meta line: image · port.
- A **domain‑scope chip** (e.g. `🌐 envy.local` or `🌐 2 domains`) — click it to
  open the domain picker. A lock icon means the scope is fixed by a label.
- **Actions:** Start / Stop / Restart, **Inspect** (`>_`), and **Remove** (🗑).
  Remove is a two‑step inline confirm so you can’t nuke a container by accident.

Stopped cards are dimmed. The **“+ Run a container”** button is top‑right.

---

## Running a new container

Click **“+ Run a container”** (Services) or the **▶** on an Images row. Fill in:

| Field | Notes |
| --- | --- |
| **Image** (required) | e.g. `postgres:16`. If you don’t have it locally, Envy pulls it first. |
| **Name** | Blank → Docker auto‑names it. |
| **Hostname** | The URL subdomain — `api` → `api.envy.local`. Blank → the container name. |
| **Domains** | Chips for each configured domain; primary preselected. Pick which domains it’s reachable on. |
| **Ports** | `host:container`, comma‑separated (`5432:5432, 8080:80`). **The published port is what gets the URL.** |
| **Environment** | `KEY=value`, one per line. |
| **Volumes** | `source:target`, one per line. Source = a named volume or a host path. |

Click **Run** → the container is created with `restart: unless-stopped`, started,
and appears in Services with its URL.

**Example (a web app with a live URL):** image `nginx:alpine`, hostname `hello`,
ports `8088:80` → `https://hello.envy.local` serves nginx immediately.

---

## The Inspect drawer

Open it with the **`>_`** icon on a card. It slides in from the right and is
**resizable** (drag the left edge) or **expandable** (the arrows button in the
header). Top to bottom:

- **URLs** — the same hero chips, plus a cert line (“HTTPS · local CA trusted”).
- **Domains** — toggle chips to choose which domains this container answers on.
  Reflects the saved assignment (works even when stopped). Read‑only when an
  `envy.domains` label is set.
- **Logs** — a live tail of `docker logs --follow`.
  - **Auto‑resumes** across a restart (no need to reopen).
  - **Clear** button wipes the *view* only — Docker’s logs are untouched.
- **Shell** — an interactive terminal into the container (`docker exec`, bash if
  present else sh). Only available while the container is running.
- **Environment / Mounts / Details** — env vars, `src → dst` mounts with
  `ro`/`rw`, and image / id / ports.

**Footer actions:** Start / Stop / Restart, **Update** (pull the latest image +
recreate this container on it — see below), and **Remove** (its own confirm).

---

## Images

- **Pull bar** — type `name:tag` (e.g. `postgres:16`, `ghcr.io/owner/app:tag`;
  omit the tag for `:latest`) and click **Pull**. Works with Docker Hub and any
  registry you prefix. *(Private/authenticated registries aren’t supported yet.)*
- **Filter** — live‑filters the local list.
- **Each row:** `name:tag`, age, an **in use / unused** pill, size, and:
  - **↻ Update** — re‑pull that tag (fetches a newer build if the registry
    moved; the old image becomes a dangling `<none>`).
  - **▶ Run** — open the Run dialog pre‑filled with this image.
  - **🗑 Remove**.

### Updating images vs. containers
- **↻ Update on an image row** just re‑pulls the tag. Your *running* container
  keeps using the old image until it’s recreated.
- **Update in a container’s Inspect drawer** pulls the latest of that
  container’s tag **and recreates the container** with the same config
  (ports/env/**volumes**/labels) on the new image. This is how you bring a
  running service current — data in volumes is preserved.

> For Compose stacks, the update/recreate works per container but Compose itself
> won’t know it happened (the container keeps its Compose labels, so it stays
> grouped). For a full stack refresh, use `docker compose pull && up`.

---

## Domains

Envy serves zero‑config HTTPS for one or more domain suffixes.

- **The first domain is *primary*** — the default for every container unless you
  scope it otherwise.
- **Add** a suffix (e.g. `acme.test`) in the bar — it applies live.
- **Make primary** — promote any domain to primary; unassigned containers switch
  their default URL to it.
- **Remove** a non‑primary domain.

Changes propagate to the running daemon automatically (new resolver file,
regenerated + re‑trusted certificate) — no prompt, no restart.

### Scoping a container to specific domains
By default a container is reachable on **only the primary domain**. To put it on
more (or fewer):
1. Open the container’s **Inspect** drawer → **Domains**.
2. Toggle the chips. (Or set the `envy.domains` label for infra‑as‑code.)

---

## Activity

A live resource monitor (like `docker stats`), updating every 1.5s while the
screen is open:
- **Summary tiles** — total CPU / Memory / Network / Disk with trend sparklines.
- **Tree table** — grouped by Compose project with per‑service CPU (mini
  sparkline), memory, network, and disk. Stopped services read `—`. Group
  collapse state is remembered.

---

## When Docker isn’t running

If no Docker engine is up, Services shows **“Docker isn’t running”** and the
header pill reads **“Docker offline.”** Envy detects your provider and offers a
**“Start ‹provider›”** button (OrbStack, Docker Desktop, colima, Rancher
Desktop). Click it and Envy **connects automatically** once the engine is up —
no app restart needed.

---

## Themes

A sun/moon toggle lives in the bottom‑left of the sidebar. Dark is the default;
your choice is remembered.

---

## How URLs are assigned (the mental model)

- **Pull** = stock an image locally. **Run** = create a container from an image.
- The moment a running container has a reachable port, Envy gives it
  `https://<name>.<domain>` and a trusted cert.
- **Which domains?** Precedence: `envy.domains` label → your per‑container
  assignment → the **primary** domain only.
- **Which hostname?** `envy.host` label → an explicit `container_name:` from the
  compose file (any name that isn’t Compose’s `<project>-<service>-<n>`
  auto-name was pinned deliberately and wins) → otherwise the Compose service
  name (replicas beyond the first get a `-N` suffix; a service name already
  taken by another container falls back to the container name) → otherwise the
  container name.
- **Which port?** `envy.port` label → a recognized web port (80, 8080, 3000…) →
  the lowest published port. A **published** port is always used when present;
  otherwise Envy routes to the container’s internal IP **where reachable** —
  OrbStack, native Linux, or any engine that passes Envy’s container‑IP
  reachability probe. On Docker Desktop, publish a port (`-p`) to get a URL.
