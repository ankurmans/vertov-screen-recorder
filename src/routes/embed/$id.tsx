import { createFileRoute, notFound } from "@tanstack/react-router";
import { PoweredBy } from "@/components/powered-by"
import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestUrl } from "@tanstack/react-start/server";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicUpload } from "@/db/schema";
import type { Transcript } from "@/lib/transcript";
import { BlurLayer } from "@/components/blur-layer";
import { CaptionLayer } from "@/components/caption-layer";
import { OverlayLayer } from "@/components/overlay-layer";
import { CameraTrack, EndCard } from "@/components/stage-layer";
import { VideoPlayer } from "@/components/video-player-lazy";
import { VertovIcon } from "@/components/vertov-icon";
import { APP_NAME } from "@/lib/brand";
import { translatorFromMatches, useT } from "@/lib/i18n/react";
import type { PlayerMessage } from "@/lib/player-message";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseCuts } from "@/lib/cuts";
import type { Cut } from "@/lib/cuts";
import { ViewerCopyHeld } from "@/components/viewer-copy-notice";
import { copyResume, trackUrl } from "@/lib/viewer-copy";
import { playbackFor } from "@/lib/viewer-copy-access.server";
import { parseOverlays } from "@/lib/overlays";
import { BACKGROUNDS, isCameraFirst, parseStyle, stageGeometry } from "@/lib/stage";
import { useSkipCuts } from "@/lib/use-skip-cuts";
import { accessFor, publicUpload } from "@/lib/access.server";
import { getUploadById, getViewerTranscript } from "@/lib/uploads.server";

const loadEmbed = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const upload = await getUploadById(id);
    if (!upload || upload.mediaType !== "video" || upload.status !== "ready") return null;
    const access = await accessFor(upload, getRequest());
    const open = access === "open";
    // Styled captions are drawn from the transcript, so it travels with the page.
    const transcript = open && upload.captionStyle !== "off" ? await getViewerTranscript(upload) : null;
    return { upload: open ? publicUpload(upload) : null, transcript, playback: open ? playbackFor(upload) : null, id, origin: getRequestUrl().origin };
  });

export const Route = createFileRoute("/embed/$id")({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{8}$/.test(params.id)) throw notFound();
    const embed = await loadEmbed({ data: params.id });
    if (!embed) throw notFound();
    return embed;
  },
  head: ({ loaderData, matches }) => ({
    meta: [{ title: `${loaderData?.upload?.title ?? translatorFromMatches(matches)("video.embed.titleFallback")} — ${APP_NAME}` }],
  }),
  component: EmbedPage,
});

/** Chrome-free player for iframes: the composed stage and a link back to the page. */
function EmbedPage() {
  const { upload, transcript, id, origin } = Route.useLoaderData();
  const t = useT();
  if (!upload) {
    return (
      <main className="flex h-dvh w-full items-center justify-center bg-neutral-950 p-6 text-center text-white">
        <a href={`${origin}/${id}`} target="_blank" rel="noreferrer" className="rounded-xl bg-white/10 px-5 py-3 text-sm font-medium hover:bg-white/20">
          {t("video.embed.protected", { app: APP_NAME })}
        </a>
        <PoweredBy overlay />
      </main>
    );
  }
  return <EmbedPlayer upload={upload} transcript={transcript} origin={origin} />;
}

function EmbedPlayer({ upload, transcript, origin }: { upload: PublicUpload; transcript: Transcript | null; origin: string }) {
  const t = useT();
  // Everyone watching an embed gets what viewers get.
  const { playback } = Route.useLoaderData();
  const held = playback?.state === "held";
  const copied = Boolean(playback?.token);
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState(0);
  const overlays = useMemo(() => parseOverlays(upload.overlays), [upload.overlays]);
  const captionStyle = isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off";
  const [main, setMain] = useState<HTMLVideoElement | null>(null);
  const [ended, setEnded] = useState(false);
  const [cameraAspect, setCameraAspect] = useState<number | null>(null);
  useEffect(() => setMounted(true), []);

  const style = parseStyle(upload.style);
  const cameraSource = upload.cameraKey ? trackUrl(`${origin}/api/camera/${upload.id}`, playback, false) : null;
  const aspect = upload.width && upload.height ? upload.width / upload.height : 16 / 9;
  const geometry = useMemo(() => stageGeometry(style, aspect, Boolean(cameraSource)), [style, aspect, cameraSource]);
  const cuts = useMemo(() => parseCuts(upload.cuts).map(([from, to]): Cut => [from, copied ? copyResume(to) : to]), [upload.cuts, copied]);
  useSkipCuts(main, cuts);
  const trimStart = upload.trimStart ? (copied ? copyResume(upload.trimStart) : upload.trimStart) : 0;
  const trimEnd = upload.trimEnd;

  // A playlist page resumes with `?t=` and starts the next video with `?autoplay=1`.
  const [start] = useState(() => {
    const query = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    return { time: Math.max(trimStart, Number(query.get("t")) || 0), autoplay: query.get("autoplay") === "1" };
  });
  const autoplayed = useRef(false);
  const toldAt = useRef(start.time);
  // Only a parent on this origin hears this, so other sites that embed the player learn nothing.
  const tell = (time: number, done: boolean) => {
    if (window.parent === window) return;
    const message: PlayerMessage = { type: "vertov:player", id: upload.id, time, ended: done, hold: Boolean(upload.ctaLabel && upload.ctaUrl) };
    window.parent.postMessage(message, window.location.origin);
  };
  useEffect(() => {
    if (ended) tell(main?.currentTime ?? 0, true);
  }, [ended]);

  const onTime = useCallback(
    (now: number, element: HTMLVideoElement) => {
      setMain((current) => (current === element ? current : element));
      setTime(now);
      if (!element.paused && Math.abs(now - toldAt.current) >= 5) {
        toldAt.current = now;
        tell(now, false);
      }
      if (now < (trimEnd ?? element.duration) - 0.05) setEnded(false);
      if (trimStart > 0 && now < trimStart - 0.05 && !element.paused) element.currentTime = trimStart;
      if (trimEnd != null && now >= trimEnd) {
        element.pause();
        setEnded(true);
      }
    },
    [trimStart, trimEnd],
  );

  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-black">
      <div className="relative max-h-full w-full" style={{ maxWidth: `calc(100dvh * ${geometry.stageAspect})` }}>
        <PoweredBy overlay />
        {held && <ViewerCopyHeld aspect={geometry.stageAspect} />}
        {mounted && !held && (
          <VideoPlayer
            zooms={style.zooms}
            src={trackUrl(`${origin}/api/media/${upload.id}`, playback, false)}
            poster={upload.posterKey ? `${origin}/api/poster/${upload.id}` : undefined}
            initialTime={start.time}
            subtitlesUrl={upload.transcriptKey ? `${origin}/api/captions/${upload.id}` : undefined}
            onActivate={(element) => {
              setMain((current) => (current === element ? current : element));
              if (start.autoplay && !autoplayed.current) {
                autoplayed.current = true;
                // The browser may refuse; the viewer then presses play.
                void element.play().catch(() => {});
              }
            }}
            onTimeUpdate={onTime}
            onEnded={() => setEnded(true)}
            stageAspect={geometry.stageAspect}
            stageBackground={(BACKGROUNDS[style.background] ?? BACKGROUNDS.none).css}
            screenBox={geometry.screen}
            screenOnTop={isCameraFirst(style.layout, Boolean(cameraSource))}
          >
            {cameraSource && geometry.camera && (
              <CameraTrack
                src={cameraSource}
                main={main}
                box={geometry.camera}
                layout={style.layout}
                shape={style.shape}
                stageAspect={geometry.stageAspect}
                editable={false}
                onAspect={setCameraAspect}
              />
            )}
            {overlays.length > 0 && <BlurLayer overlays={overlays} geometry={geometry} zooms={style.zooms} video={main} time={time} cameraAspect={cameraAspect} screenAspect={upload.width && upload.height ? aspect : null} />}
            {overlays.length > 0 && <OverlayLayer overlays={overlays} time={time} aspect={geometry.stageAspect} />}
            {transcript && captionStyle !== "off" && <CaptionLayer transcript={transcript} time={time} video={main} style={captionStyle} />}
            {ended && (
              <EndCard
                ctaLabel={upload.ctaLabel}
                ctaUrl={upload.ctaUrl}
                uploadId={upload.id}
                onReplay={() => {
                  setEnded(false);
                  if (main) {
                    main.currentTime = trimStart;
                    void main.play();
                  }
                }}
              />
            )}
          </VideoPlayer>
        )}
        <a
          href={`${origin}/${upload.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 left-2 z-30 max-w-[70%] truncate rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur hover:bg-black/80"
        >
          {upload.title ?? t("video.embed.watch")} · {APP_NAME} <VertovIcon name="external" size={12} className="ml-1" />
        </a>
      </div>
    </main>
  );
}
