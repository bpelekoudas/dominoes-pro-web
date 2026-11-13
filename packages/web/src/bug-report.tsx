import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { BUILD_SHA } from "./build-sha";
import { clientLogLines, setReportContext, type ReportContext } from "./client-log";

const SHOT_MAX = 700_000;

/** A small drawing of where the tiles sit. A photo from the phone is clearer, and this still shows a cutoff. */
export function captureBoardSketch(): string | null {
  const frame = document.querySelector(".table-frame");
  if (!(frame instanceof HTMLElement)) return null;
  const rect = frame.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;
  const tiles = [...frame.querySelectorAll<HTMLElement>("[data-board-tile]")];
  if (tiles.length === 0) return null;
  const scale = Math.min(1, 480 / rect.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#143328";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.font = "10px sans-serif";
  ctx.textBaseline = "top";
  for (const tile of tiles) {
    const box = tile.getBoundingClientRect();
    const x = box.left - rect.left;
    const y = box.top - rect.top;
    ctx.fillStyle = "#f4f1e8";
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, Math.max(1, box.width), Math.max(1, box.height));
    ctx.strokeRect(x, y, Math.max(1, box.width), Math.max(1, box.height));
    ctx.fillStyle = "#111";
    ctx.fillText(tile.dataset.boardTile ?? "", x + 2, y + 2);
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

function dataBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("picture"));
    image.src = src;
  });
}

/** Shrink a chosen photo so the report stays under the server cap. */
export async function shrinkScreenshot(dataUrl: string): Promise<string | null> {
  if (dataBytes(dataUrl) <= SHOT_MAX && dataUrl.startsWith("data:image/jpeg")) return dataUrl;
  try {
    const image = await loadImage(dataUrl);
    const edge = Math.max(image.width, image.height);
    const scale = edge > 960 ? 960 / edge : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let quality = 0.7;
    let url = canvas.toDataURL("image/jpeg", quality);
    while (dataBytes(url) > SHOT_MAX && quality > 0.4) {
      quality -= 0.1;
      url = canvas.toDataURL("image/jpeg", quality);
    }
    return dataBytes(url) <= SHOT_MAX ? url : null;
  } catch {
    return null;
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("picture"));
    reader.readAsDataURL(file);
  });
}

export function BugReport({ context }: { context: ReportContext }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [fileName, setFileName] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const titleId = useId();

  useEffect(() => {
    setReportContext(context);
  }, [context.roomCode, context.playerId, context.seat, context.tableSize, context.handNumber]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const close = () => {
    if (busy) return;
    setOpen(false);
  };

  const onFile = async (file: File | null) => {
    setNote("");
    if (!file) {
      setPhoto(null);
      setFileName("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setPhoto(null);
      setFileName("");
      setNote("Choose a picture.");
      return;
    }
    try {
      const raw = await readFile(file);
      const shrunk = await shrinkScreenshot(raw);
      if (!shrunk) {
        setPhoto(null);
        setFileName("");
        setNote("That picture is too big.");
        return;
      }
      setPhoto(shrunk);
      setFileName(file.name);
    } catch {
      setPhoto(null);
      setFileName("");
      setNote("That picture could not be read.");
    }
  };

  const send = async () => {
    const text = description.trim();
    if (text.length < 3) {
      setNote("Describe what went wrong.");
      return;
    }
    setBusy(true);
    setNote("");
    const sketch = photo ? null : captureBoardSketch();
    const screenshot = photo ?? sketch;
    try {
      const response = await fetch("/api/ops/bug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          description: text.slice(0, 2000),
          screenshot,
          buildSha: BUILD_SHA,
          roomCode: context.roomCode,
          playerId: context.playerId,
          seat: context.seat,
          tableSize: context.tableSize,
          handNumber: context.handNumber,
          userAgent: navigator.userAgent.slice(0, 200),
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          logs: clientLogLines(),
        }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setNote(body?.error ?? "That report did not send.");
        setBusy(false);
        return;
      }
      setDescription("");
      setPhoto(null);
      setFileName("");
      setBusy(false);
      setNote("Sent. Thank you.");
    } catch {
      setBusy(false);
      setNote("That report did not send.");
    }
  };

  const sheet =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="bug-layer" role="presentation" onClick={close}>
            <form
              className="bug-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              onClick={(event) => event.stopPropagation()}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <header>
                <h2 id={titleId}>Report a bug</h2>
                <button type="button" className="text-button" onClick={close}>
                  Close
                </button>
              </header>
              <p className="bug-note">
                Only the people who run the game can read this. It is not shown at the table, and it does not include your email.
              </p>
              <label className="bug-field">
                What went wrong?
                <textarea
                  value={description}
                  maxLength={2000}
                  rows={4}
                  required
                  data-action="bug-description"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="bug-field">
                Screenshot, if you have one
                <input
                  type="file"
                  accept="image/*"
                  data-action="bug-screenshot"
                  onChange={(event) => {
                    void onFile(event.target.files?.[0] ?? null);
                  }}
                />
              </label>
              <p className="bug-note">
                {fileName
                  ? `Attached ${fileName}.`
                  : "If you leave this empty, a sketch of the board is attached when tiles are on the table."}{" "}
                The report also includes the build, room, seat, hand, and recent errors.
              </p>
              {note ? <p className="bug-status">{note}</p> : null}
              <button type="submit" className="primary" data-action="bug-send" disabled={busy}>
                {busy ? "Sending…" : "Send report"}
              </button>
            </form>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        className="bug-entry"
        data-action="report-bug"
        aria-label="Report a bug"
        onClick={() => {
          setNote("");
          setOpen(true);
        }}
      >
        <span className="bug-short">Bug</span>
        <span className="bug-long">Report a bug</span>
      </button>
      {sheet}
    </>
  );
}
