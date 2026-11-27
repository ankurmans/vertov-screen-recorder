import { Tabs } from "@cloudflare/kumo/components/tabs";
import { PoweredBy } from "@/components/powered-by"
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import { Button, LinkButton } from "@cloudflare/kumo/components/button";
import {
  ArrowSquareOutIcon,
  CircleNotchIcon,
  DownloadSimpleIcon,
  LinkIcon,
  SlidersHorizontalIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicUpload as Upload } from "@/db/schema";
import type { Author } from "@/lib/uploads.server";
import { spokenWords, type Transcript } from "@/lib/transcript";
import { WatchedCard } from "@/components/watched-card";
import type { Chapter } from "@/lib/chapters";
import type { AuthState } from "@/lib/use-auth";
import type { FloatingReaction } from "@/components/stage-layer";
import type { StudioState } from "@/components/studio-panel";
import type { Cut } from "@/lib/cuts";
import type { Overlay } from "@/lib/overlays";
import { pinBlurs } from "@/lib/blur-pins";
import { AnnotateEditor } from "@/components/annotate-editor";
import { BlurLayer } from "@/components/blur-layer";
import { CaptionLayer } from "@/components/caption-layer";
import { CommentsPanel } from "@/components/comments-panel";
import { LikeButton } from "@/components/like-button";
import { WatchLaterButton } from "@/components/watch-later-button";
import { MoveButton } from "@/components/move-dialog";
import { LivePlayer } from "@/components/live-player";
import { OverlayLayer } from "@/components/overlay-layer";
import { ShareHeader } from "@/components/share-header";
import { CameraTrack, EndCard, ReactionLayer, countCtaClick } from "@/components/stage-layer";
import { AiPanel } from "@/components/ai-panel";
import { StudioPanel } from "@/components/studio-panel";
import { markGuide } from "@/components/library-guide";
import { TranscriptEditor } from "@/components/transcript-editor";
import { TranscriptPanel } from "@/components/transcript-panel";
import { makeAnimatedThumbnail } from "@/lib/gif";
import { parseCuts, visibleChapters } from "@/lib/cuts";
import { ViewerCopyHeld, ViewerCopyNotice } from "@/components/viewer-copy-notice";
import { copyResume, keptWindow, needsCopy, trackUrl } from "@/lib/viewer-copy";
import { trackMasks } from "@/lib/viewer-masks";
import type { Playback } from "@/lib/viewer-copy";
import { parseOverlays } from "@/lib/overlays";
import { useSkipCuts } from "@/lib/use-skip-cuts";
import { VideoPlayer } from "@/components/video-player-lazy";
import { getChapterAtTime } from "@/lib/chapters";
import { useAiTextNotice, type AiTextNotice } from "@/components/ai-text-notice";
import { formatDuration } from "@/lib/format";
import { useLanguage, useT } from "@/lib/i18n/react";
import { localizedTimeAgo, localizedViews } from "@/lib/i18n/format";
import { HOSTED_EDITION } from "@/lib/edition";
import { REACTION_EMOJIS, anonymousViewerId } from "@/lib/reactions";
import { ReactionIcon, reactionLabel } from "@/components/reaction-icon";
import { BACKGROUNDS, isCameraFirst, parseStyle, stageGeometry } from "@/lib/stage";
import { isCaptionStyle } from "@/lib/caption-styles";
import { parseStoryboardMeta } from "@/lib/storyboard";
import { useAuth } from "@/lib/use-auth";
import { recordShareView } from "@/lib/viewer-identity";

interface VideoShareProps {
  upload: Upload;
  author: Author;
  origin: string;
  transcript: Transcript | null;
  likeCount: number;
  auth: AuthState;
  isOwner: boolean;
  /** The owner is a guest, so the link is not live yet and the claim gate is showing. */
  claimRequired?: boolean;
  exportReady: boolean;
  initialTime?: number;
  initialPanel?: "customize";
  /** Free workspaces show a small "Made with Vertov" link in the header. */
  /** Which files viewers of an edited video get; see src/lib/viewer-copy.ts. */
  playback?: Playback;
  /** The request link viewers answer through, when the sender asked for a video reply. */
  replyRequestId?: string | null;
}

interface StoredReaction {
  id: string;
  emoji: string;
  timestamp: number;
  viewerName: string | null;
}

/** The share page: the composed stage (screen + camera + background),
 *  a sidebar for transcript/comments/insights, and the owner's studio. */
export function VideoShare({
  upload,
  author,
  origin,
  transcript,
  likeCount,
  auth: initialAuth,
  isOwner,
  claimRequired = false,
  exportReady,
  initialTime = 0,
  initialPanel,
  playback,
  replyRequestId = null,
}: VideoShareProps) {
  const t = useT();
  const [replyId, setReplyId] = useState(replyRequestId);
  const [mounted, setMounted] = useState(false);
  // Set when the recorder stopped at a Free plan's length rule (or ran past it): the upgrade card shows once.
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [activeTab, setActiveTab] = useState(
    transcript ? "transcript" : "comments",
  );
  const [views, setViews] = useState(upload.views);
  const [mainVideo, setMainVideo] = useState<HTMLVideoElement | null>(null);
  const [ended, setEnded] = useState(false);
  const [floating, setFloating] = useState<Array<FloatingReaction>>([]);
  const [reactions, setReactions] = useState<Array<StoredReaction>>([]);
  const [studioOpen, setStudioOpen] = useState(initialPanel === "customize" && isOwner);
  useEffect(() => {
    if (initialPanel === "customize" && isOwner) markGuide("customized");
  }, [initialPanel, isOwner]);
  const [zoomFocusPicker, setZoomFocusPicker] = useState<((x: number, y: number) => void) | null>(null);
  const pickZoomFocus = useCallback((picker: ((x: number, y: number) => void) | null) => {
    setZoomFocusPicker(() => picker);
  }, []);
  const [studio, setStudio] = useState<StudioState>(() => ({
    style: parseStyle(upload.style),
    trimStart: upload.trimStart,
    trimEnd: upload.trimEnd,
    ctaLabel: upload.ctaLabel,
    ctaUrl: upload.ctaUrl,
    socialEnabled: upload.socialEnabled,
    downloadsEnabled: upload.downloadsEnabled,
    requireEmail: upload.requireEmail,
    searchIndexing: upload.searchIndexing,
    openLink: upload.visibility === "link",
    captionStyle: isCaptionStyle(upload.captionStyle) ? upload.captionStyle : "off",
  }));
  // A blur saved without pins gets them for the layout it is read in, before a change of layout here can move what it covers.
  const [overlays, setOverlays] = useState<Array<Overlay>>(() =>
    pinBlurs(parseOverlays(upload.overlays), stageGeometry(parseStyle(upload.style), upload.width && upload.height ? upload.width / upload.height : 16 / 9, Boolean(upload.cameraKey))),
  );
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [cameraAspect, setCameraAspect] = useState<number | null>(null);
  const overlaySaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [cuts, setCuts] = useState<Array<Cut>>(() => parseCuts(upload.cuts));
  const cutSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const activeVideoRef = useRef<HTMLVideoElement | null>(null);
  const lastTimeRef = useRef(initialTime);
  const progressRef = useRef({ max: 0, sent: 0 });
  const toastManager = useKumoToastManager();
  const { auth, signOut } = useAuth(initialAuth);

  useEffect(() => setMounted(true), []);

  // The send receipt and the offer to ask for one back, shown after a recording. Remembered for the tab, because the
  // page reloads itself while the transcript is being made.
  const [justRecorded, setJustRecorded] = useState(false);
  useEffect(() => {
    try {
      if (isOwner && Date.now() - Number(sessionStorage.getItem(`vertov:just-recorded:${upload.id}`)) < 30 * 60_000) setJustRecorded(true);
    } catch {
      // Without storage these show until the first reload.
    }
  }, []);

  // Straight from the recorder: confirm the link is ready, then tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("new")) return;
    if (isOwner && !claimRequired) {
      toastManager.add({ title: t("video.toast.linkOnClipboard") });
      setJustRecorded(true);
      try {
        sessionStorage.setItem(`vertov:just-recorded:${upload.id}`, String(Date.now()));
      } catch {
        // Shown for this load only.
      }
    }
    if (isOwner && url.searchParams.has("limit")) {
      toastManager.add({ title: t("video.toast.sixHourLimit") });
    }
    url.searchParams.delete("new");
    url.searchParams.delete("limit");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  const notify = useCallback(
    (message: string, variant?: "error") => toastManager.add({ title: message, variant }),
    [toastManager],
  );

  const { hidden: aiHidden, apply: applyAiNotice } = useAiTextNotice(notify);

  const mediaSource = trackUrl(`${origin}/api/media/${upload.id}`, playback, isOwner);
  // An edited video's viewers play a copy with the removed footage blanked, or wait for it; its previews would show it.
  const held = !isOwner && playback?.state === "held";
  const limited = !isOwner && (playback?.state ?? "original") !== "original";

  // Every video gets an animated thumbnail for emails and link previews: made once, in the owner's browser, and kept.
  // It starts shortly after the owner first opens the finished video, and "Copy animated preview" waits for it if it is
  // still being made. It never blocks anything and fails quietly (the still poster stands in).
  const gifJob = useRef<Promise<boolean> | null>(null);
  const [gifMade, setGifMade] = useState(false);
  // The thumbnail is made from the recording as captured, so a video with hidden areas has none.
  const hidesAreas = Object.keys(trackMasks({ ...upload, overlays: JSON.stringify(overlays) })).length > 0;
  const canMakeGif = !hidesAreas && HOSTED_EDITION && isOwner && upload.status === "ready" && upload.mediaType === "video" && (upload.duration ?? 0) >= 2;
  const ensureGif = useCallback((): Promise<boolean> => {
    if (upload.gifKey || gifMade) return Promise.resolve(true);
    if (!canMakeGif) return Promise.resolve(false);
    gifJob.current ??= (async () => {
      try {
        // Only from footage that is kept: the thumbnail goes to viewers.
        const [from, to] = keptWindow({ trimStart: studio.trimStart, trimEnd: studio.trimEnd, cuts: JSON.stringify(cuts) }, upload.duration ?? 0);
        const blob = await makeAnimatedThumbnail(mediaSource, from, to);
        const response = await fetch(`/api/recordings/${upload.id}/sidecar?kind=gif`, { method: "PUT", headers: { "content-type": "image/gif" }, body: blob });
        if (!response.ok) throw new Error("gif upload failed");
        setGifMade(true);
        return true;
      } catch {
        gifJob.current = null;
        return false;
      }
    })();
    return gifJob.current;
  }, [upload.gifKey, upload.id, upload.duration, studio.trimStart, studio.trimEnd, cuts, gifMade, canMakeGif, mediaSource]);
  const gifStarted = useRef(false);
  useEffect(() => {
    if (!canMakeGif || upload.gifKey || gifStarted.current) return;
    gifStarted.current = true;
    const timer = setTimeout(() => void ensureGif(), 4000);
    return () => clearTimeout(timer);
  }, [canMakeGif, upload.gifKey, ensureGif]);
  const cameraSource = upload.cameraKey ? trackUrl(`${origin}/api/camera/${upload.id}`, playback, isOwner) : null;
  const posterSource = upload.posterKey
    ? `${origin}/api/poster/${upload.id}?v=${encodeURIComponent(upload.posterKey)}`
    : undefined;
  const subtitlesUrl =
    upload.transcriptKey
      ? `${origin}/api/captions/${upload.id}`
      : undefined;
  const thumbnailsUrl = upload.storyboardKey && !limited
    ? `${origin}/api/storyboard-vtt/${upload.id}`
    : undefined;
  const hasTranscript = transcript !== null;
  const showComments = studio.socialEnabled;
  const hasSidebar = hasTranscript || showComments || isOwner;
  const isRecording = upload.status !== "ready";
  const aiPending = upload.aiStatus === "pending";
  const duration = upload.duration ?? 0;
  // The copy is painted slightly past each removed stretch, so its playback comes back just beyond.
  const copied = !isOwner && Boolean(playback?.token);
  const trimStart = studio.trimStart ? (copied ? copyResume(studio.trimStart) : studio.trimStart) : 0;
  const trimEnd = studio.trimEnd ?? null;

  // Transcript, title and summary arrive a few seconds after the video is playable.
  useEffect(() => {
    if (!isRecording && !aiPending) return;
    // A recording in progress polls for its end itself (see LivePlayer).
    if (upload.status === "recording") return;
    const timer = setTimeout(() => window.location.reload(), 6000);
    return () => clearTimeout(timer);
  }, [isRecording, aiPending]);

  const aspect =
    upload.width && upload.height ? upload.width / upload.height : 16 / 9;
  const geometry = useMemo(
    () => stageGeometry(studio.style, aspect, Boolean(cameraSource)),
    [studio.style, aspect, cameraSource],
  );
  const background = BACKGROUNDS[studio.style.background] ?? BACKGROUNDS.none;

  const storyboard = useMemo(() => {
    if (limited || !upload.storyboardKey || !upload.storyboardMeta) return null;
    try {
      const meta = parseStoryboardMeta(JSON.parse(upload.storyboardMeta));
      return meta
        ? { url: `${origin}/api/storyboard/${upload.id}`, meta }
        : null;
    } catch {
      return null;
    }
  }, [limited, upload.storyboardKey, upload.storyboardMeta, upload.id, origin]);

  const chapters = useMemo<Array<Chapter> | undefined>(() => {
    if (!upload.chapters || aiHidden.chapters) return undefined;
    try {
      const stored: Array<{ title: string; start: number }> = JSON.parse(
        upload.chapters,
      );
      if (!Array.isArray(stored)) return undefined;
      const parsed = visibleChapters(stored, { trimStart: studio.trimStart, trimEnd: studio.trimEnd, cuts: JSON.stringify(cuts) }, upload.duration);
      if (parsed.length === 0) return undefined;
      return parsed.map((chapter, index) => ({
        title: chapter.title,
        startTime: chapter.start,
        endTime:
          index < parsed.length - 1
            ? parsed[index + 1].start
            : (upload.duration ?? Number.MAX_SAFE_INTEGER),
      }));
    } catch {
      return undefined;
    }
  }, [upload.chapters, upload.duration, studio.trimStart, studio.trimEnd, cuts, aiHidden.chapters]);

  const currentChapter = useMemo(() => {
    if (!chapters?.length) return null;
    return getChapterAtTime(chapters, currentTime);
  }, [chapters, currentTime]);

  useEffect(() => {
    if (!studio.socialEnabled) return;
    void fetch(`/api/reactions/${upload.id}`)
      .then((response) =>
        response.ok
          ? response.json<{ reactions: Array<StoredReaction> }>()
          : { reactions: [] },
      )
      .then((body) => setReactions(body.reactions))
      .catch(() => {});
  }, [upload.id, studio.socialEnabled]);

  const float = useCallback((emoji: string, name?: string | null) => {
    const key = crypto.randomUUID();
    setFloating((items) => [...items.slice(-12), { key, emoji, name }]);
    setTimeout(() => setFloating((items) => items.filter((item) => item.key !== key)), 2700);
  }, []);

  const sendProgress = useCallback(
    (element: HTMLVideoElement) => {
      if (isOwner) return;
      const span = (trimEnd ?? (element.duration || duration)) - trimStart;
      if (!(span > 0)) return;
      const percent = Math.min(1, Math.max(0, (progressRef.current.max - trimStart) / span));
      if (percent - progressRef.current.sent < 0.04 && percent < 0.99) return;
      progressRef.current.sent = percent;
      void fetch(`/api/progress/${upload.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ viewerKey: anonymousViewerId(), percent, seconds: progressRef.current.max }),
        keepalive: true,
      }).catch(() => {});
    },
    [isOwner, trimEnd, trimStart, duration, upload.id],
  );

  const handlePlayerActivate = useCallback((element: HTMLVideoElement) => {
    activeVideoRef.current = element;
    setMainVideo((current) => (current === element ? current : element));
  }, []);

  const handlePlayerTimeUpdate = useCallback(
    (time: number, element: HTMLVideoElement) => {
      activeVideoRef.current = element;
      setMainVideo((current) => (current === element ? current : element));
      if (time < (trimEnd ?? element.duration) - 0.05) setEnded(false);
      // Trimmed playback: start at the trim-in point, stop at the trim-out point.
      if (trimStart > 0 && time < trimStart - 0.05 && !element.paused) {
        element.currentTime = trimStart;
      }
      if (trimEnd != null && time >= trimEnd) {
        element.pause();
        element.currentTime = trimEnd;
        setEnded(true);
      }
      const previous = lastTimeRef.current;
      // Replay reactions the moment playback passes them (not on seeks).
      if (time > previous && time - previous < 1.5 && !element.paused) {
        for (const reaction of reactions) {
          if (reaction.timestamp > previous && reaction.timestamp <= time) {
            float(reaction.emoji, reaction.viewerName);
          }
        }
      }
      lastTimeRef.current = time;
      progressRef.current.max = Math.max(progressRef.current.max, time);
      setCurrentTime(time);
      sendProgress(element);
    },
    [trimStart, trimEnd, reactions, float, sendProgress],
  );

  const skipped = useMemo(() => (copied ? cuts.map(([from, to]): Cut => [from, copyResume(to)]) : cuts), [cuts, copied]);
  useSkipCuts(mainVideo, skipped);

  const updateCuts = useCallback(
    (next: Array<Cut>) => {
      setCuts(next);
      clearTimeout(cutSaveTimer.current);
      cutSaveTimer.current = setTimeout(() => {
        void fetch(`/api/recordings/${upload.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cuts: next }),
        }).then(async (response) => {
          if (!response.ok) return notify(t("video.toast.editSaveFailed"), "error");
          const body = (await response.json().catch(() => ({}))) as { aiNotice?: AiTextNotice };
          applyAiNotice(body.aiNotice);
        });
      }, 500);
    },
    [upload.id, notify, applyAiNotice, t],
  );

  useEffect(() => {
    const element = mainVideo;
    if (!element) return;
    const onPlay = () => {
      setEnded(false);
      if (element.currentTime < trimStart || (trimEnd != null && element.currentTime >= trimEnd - 0.05)) {
        element.currentTime = trimStart;
      }
    };
    const onPause = () => sendProgress(element);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    if (trimStart > 0 && element.currentTime < trimStart) element.currentTime = trimStart;
    return () => {
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
    };
  }, [mainVideo, trimStart, trimEnd, sendProgress]);

  const handleSeek = useCallback((time: number) => {
    const el = activeVideoRef.current;
    if (el) {
      el.currentTime = time;
      void el.play().catch(() => {});
    }
    setCurrentTime(time);
  }, []);

  const replay = useCallback(() => {
    setEnded(false);
    handleSeek(trimStart);
  }, [handleSeek, trimStart]);

  const react = useCallback(
    async (emoji: string) => {
      const timestamp = activeVideoRef.current?.currentTime ?? currentTime;
      float(emoji, auth.user?.name);
      const response = await fetch(`/api/reactions/${upload.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji, timestamp, viewerId: anonymousViewerId() }),
      }).catch(() => null);
      if (response?.ok) {
        const body: { reaction: StoredReaction } = await response.json();
        setReactions((items) => [...items, body.reaction].sort((a, b) => a.timestamp - b.timestamp));
      }
    },
    [currentTime, float, upload.id, auth.user?.name],
  );

  const getFrame = useCallback(async () => {
    const element = activeVideoRef.current;
    if (!element || !element.videoWidth) return null;
    const scale = Math.min(1, 1280 / element.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(element.videoWidth * scale);
    canvas.height = Math.round(element.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  }, []);

  // Count each viewer once, client-guarded.
  useEffect(() => {
    if (isOwner || held) return;
    void recordShareView(upload.id).then(
      (counted) => counted && setViews((count) => count + 1),
    );
  }, [upload.id, isOwner]);

  // What every viewer sees comes first, as on Loom; the owner's tools follow.
  const tabs = [
    ...(hasTranscript ? [{ value: "transcript", label: t("video.tab.transcript") }] : []),
    ...(showComments ? [{ value: "comments", label: t("video.tab.comments") }] : []),
    ...(HOSTED_EDITION && isOwner && !isRecording ? [{ value: "ai", label: t("video.tab.ai") }] : []),
    ...(isOwner && transcript?.words?.length ? [{ value: "edit", label: t("video.tab.edit") }] : []),
    ...(isOwner && !isRecording ? [{ value: "annotate", label: t("video.tab.annotate") }] : []),
  ];
  const tab = tabs.some((item) => item.value === activeTab) ? activeTab : (tabs[0]?.value ?? "");
  const sidebarTabs =
    tabs.length > 1 ? (
      <div className="shrink-0 overflow-x-auto border-b border-neutral-200 px-3 py-3">
        <Tabs tabs={tabs} value={tab} onValueChange={setActiveTab} className="min-w-max" />
      </div>
    ) : null;

  const sidebarContent =
    tab === "transcript" && transcript ? (
      <TranscriptPanel
        transcript={transcript}
        currentTime={currentTime}
        onSeek={handleSeek}
        storyboard={storyboard}
        className="h-full"
      />
    ) : tab === "edit" && transcript && isOwner ? (
      <TranscriptEditor
        transcript={transcript}
        cuts={cuts}
        duration={duration}
        currentTime={currentTime}
        onSeek={handleSeek}
        onChange={updateCuts}
        className="h-full"
      />
    ) : tab === "annotate" && isOwner ? (
      <AnnotateEditor
        uploadId={upload.id}
        overlays={overlays}
        selectedId={selectedOverlay}
        currentTime={currentTime}
        duration={duration}
        onSelect={setSelectedOverlay}
        onChange={updateOverlays}
        onSeek={handleSeek}
        className="h-full"
      />
    ) : tab === "comments" && showComments ? (
      <CommentsPanel
        uploadId={upload.id}
        currentTime={currentTime}
        onSeek={handleSeek}
        auth={auth}
        className="h-full"
      />
    ) : tab === "ai" && isOwner ? (
      <AiPanel uploadId={upload.id} className="h-full" />
    ) : null;

  function updateOverlays(edited: Array<Overlay>) {
    // A blur is pinned to what it covers as the owner sees it now, zoom included.
    const next = pinBlurs(edited, geometry, { previous: overlays, zooms: studio.style.zooms ?? [], time: activeVideoRef.current?.currentTime ?? currentTime });
    setOverlays(next);
    clearTimeout(overlaySaveTimer.current);
    overlaySaveTimer.current = setTimeout(() => {
      void fetch(`/api/recordings/${upload.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overlays: next }),
      }).then((response) => {
        if (!response.ok) notify(t("video.toast.annotationsSaveFailed"), "error");
      });
    }, 500);
  }

  const player = upload.status === "recording" ? (
    <LivePlayer id={upload.id} />
  ) : isRecording ? (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-neutral-900 text-sm text-neutral-300">
      <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
      {upload.status === "importing"
        ? t("video.status.importing")
        : upload.status === "rendering"
          ? t("video.status.rendering")
        : upload.status === "failed"
          ? (HOSTED_EDITION ? t("video.status.failedLoom") : t("video.status.failed"))
          : t("video.status.stillRecording")}
    </div>
  ) : held ? (
    <ViewerCopyHeld aspect={geometry.stageAspect} />
  ) : !mounted ? (
    // The player is client-only; the poster holds the space until it mounts.
    <div className="relative w-full bg-black" style={{ aspectRatio: String(geometry.stageAspect) }}>
      {posterSource && <img src={posterSource} alt="" className="size-full object-contain" />}
    </div>
  ) : (
    <VideoPlayer
      src={mediaSource}
      poster={posterSource}
      initialTime={Math.max(initialTime, trimStart)}
      subtitlesUrl={subtitlesUrl}
      thumbnailsUrl={thumbnailsUrl}
      onActivate={handlePlayerActivate}
      onTimeUpdate={handlePlayerTimeUpdate}
      onEnded={() => setEnded(true)}
      stageAspect={geometry.stageAspect}
      stageBackground={background.css}
      screenBox={geometry.screen}
      screenOnTop={isCameraFirst(studio.style.layout, Boolean(cameraSource))}
      zooms={studio.style.zooms}
      onPickZoomFocus={zoomFocusPicker ? (x, y) => { zoomFocusPicker(x, y); setZoomFocusPicker(null); } : undefined}
      className="block h-full w-full"
    >
      {cameraSource && geometry.camera && (
        <CameraTrack
          src={cameraSource}
          main={mainVideo}
          box={geometry.camera}
          layout={studio.style.layout}
          shape={studio.style.shape}
          stageAspect={geometry.stageAspect}
          editable={isOwner && studioOpen}
          onAspect={setCameraAspect}
          onStyleChange={(patch) => {
            const style = { ...studio.style, ...patch };
            setStudio({ ...studio, style });
            void fetch(`/api/recordings/${upload.id}`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ style }),
            });
          }}
        />
      )}
      {overlays.length > 0 && (
        <BlurLayer
          overlays={overlays}
          geometry={geometry}
          zooms={studio.style.zooms}
          video={mainVideo}
          time={currentTime}
          cameraAspect={cameraAspect}
          screenAspect={upload.width && upload.height ? aspect : null}
          edit={isOwner && tab === "annotate"}
          selectedId={selectedOverlay}
          onSelect={setSelectedOverlay}
          onChange={(next) => updateOverlays(overlays.map((item) => (item.id === next.id ? next : item)))}
        />
      )}
      {overlays.length > 0 && (
        <OverlayLayer
          overlays={overlays}
          time={currentTime}
          aspect={geometry.stageAspect}
          edit={isOwner && tab === "annotate"}
          selectedId={selectedOverlay}
          onSelect={setSelectedOverlay}
          onChange={(next) => updateOverlays(overlays.map((item) => (item.id === next.id ? next : item)))}
        />
      )}
      {transcript && studio.captionStyle !== "off" && <CaptionLayer transcript={transcript} time={currentTime} video={mainVideo} style={studio.captionStyle} />}
      <ReactionLayer items={floating} />
      {ended && (
        <EndCard
          ctaLabel={studio.ctaLabel}
          ctaUrl={studio.ctaUrl}
          uploadId={upload.id}
          onReplay={replay}
          reply={replyId && !isOwner ? { href: `/request/${replyId}`, label: t("video.reply.button") } : undefined}
        />
      )}
    </VideoPlayer>
  );

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <ShareHeader user={auth.user} onSignOut={() => void signOut()} />

      <div className="flex-1 px-4 py-4 lg:px-8 lg:py-6">
        <div className={`mx-auto grid w-full grid-cols-1 items-start gap-6 ${hasSidebar ? "max-w-[1600px] lg:grid-cols-[minmax(0,1fr)_384px]" : "max-w-6xl"}`}>
          <div className="min-w-0">
            <div
              className="mx-auto w-full overflow-hidden rounded-xl ring-1 ring-neutral-200"
              style={geometry.stageAspect < 1 ? { maxWidth: `calc(max(320px, 100dvh - 260px) * ${geometry.stageAspect})` } : undefined}
            >
              {player}
            </div>
            {isOwner && playback?.enabled && !isRecording && (
              <ViewerCopyNotice
                uploadId={upload.id}
                held={playback.state === "held"}
                failed={playback.failed}
                changed={
                  needsCopy({ ...upload, trimStart: studio.trimStart, trimEnd: studio.trimEnd, cuts: JSON.stringify(cuts), overlays: JSON.stringify(overlays), style: JSON.stringify(studio.style) }) &&
                  JSON.stringify([studio.trimStart, studio.trimEnd, cuts, trackMasks({ ...upload, overlays: JSON.stringify(overlays), style: JSON.stringify(studio.style) })]) !==
                    JSON.stringify([upload.trimStart, upload.trimEnd, parseCuts(upload.cuts), trackMasks(upload)])
                }
              />
            )}
            {!isRecording && studio.socialEnabled && (
              <ReactionBar onReact={(emoji) => void react(emoji)} reactions={reactions} duration={trimEnd ?? duration} onSeek={handleSeek} />
            )}
            <div className="mt-4 w-full">
              <VideoInfo
                replyId={replyId}
                onReplyChange={setReplyId}
                justRecorded={justRecorded}
                wordCount={spokenWords(transcript)}
                hideSummary={aiHidden.summary}
                upload={upload}
                origin={origin}
                author={author}
                views={views}
                likeCount={likeCount}
                auth={auth}
                showLike={showComments}
                mediaSource={mediaSource}
                isOwner={isOwner}
                exportReady={exportReady}
                aiPending={aiPending}
                ctaLabel={studio.ctaLabel}
                ctaUrl={studio.ctaUrl}
                uploadId={upload.id}
                currentTime={currentTime}
                studioOpen={studioOpen}
                onToggleStudio={() => setStudioOpen((open) => !open)}
                onNotify={notify}
                canMakeGif={canMakeGif}
                gifReady={Boolean(upload.gifKey) || gifMade}
                ensureGif={ensureGif}
              />

              {isOwner && !claimRequired && <WatchedCard views={views} />}

              {currentChapter && <CurrentChapterIndicator chapter={currentChapter} />}

              {isOwner && studioOpen && !isRecording && (
                <StudioPanel
                  uploadId={upload.id}
                  state={studio}
                  onChange={setStudio}
                  hasCamera={Boolean(cameraSource)}
                  currentTime={currentTime}
                  duration={duration}
                  getFrame={getFrame}
                  mediaSource={mediaSource}
                  canMakeGif={!hidesAreas}
                  hasTranscript={hasTranscript}
                  onNotify={notify}
                  onAiNotice={applyAiNotice}
                  onSeek={(time) => { if (activeVideoRef.current) { activeVideoRef.current.currentTime = time; activeVideoRef.current.pause(); } setCurrentTime(time); }}
                  onPickZoomFocus={pickZoomFocus}
                  cuts={cuts}
                  onCutsChange={updateCuts}
                />
              )}
            </div>
          </div>

          {hasSidebar && (
            <aside aria-label={t("video.sidebar.label")} className="flex h-[480px] min-h-0 min-w-0 flex-col rounded-xl border border-neutral-200 bg-white lg:sticky lg:top-6 lg:h-[720px]" style={{ maxHeight: "calc(100dvh - 104px)" }}>
              {sidebarTabs}
              <div className="min-h-0 flex-1 py-3">
                {sidebarContent}
              </div>
            </aside>
          )}
        </div>
      </div>
      <PoweredBy className="py-6" />
    </div>
  );
}

/** Quick reactions under the player, with markers on a mini timeline. */
function ReactionBar({
  onReact,
  reactions,
  duration,
  onSeek,
}: {
  onReact: (emoji: string) => void;
  reactions: Array<StoredReaction>;
  duration: number;
  onSeek: (time: number) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-3 pt-3">
      <div className="flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white p-1">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className="flex size-8 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-[var(--brand-accent,#de2b14)] active:scale-95"
            aria-label={t("video.reactions.react", { label: reactionLabel(emoji, t) })}
            title={reactionLabel(emoji, t)}
          >
            <ReactionIcon code={emoji} />
          </button>
        ))}
      </div>
      {reactions.length > 0 && duration > 0 && (
        <div className="relative h-7 min-w-32 flex-1" title={t("video.reactions.onTimeline")}>
          <div className="absolute inset-x-0 top-1/2 h-px bg-neutral-200" />
          {reactions.map((reaction) => (
            <button
              key={reaction.id}
              type="button"
              onClick={() => onSeek(reaction.timestamp)}
              className="absolute top-0 flex size-6 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-200 bg-white text-[var(--brand-accent,#de2b14)] transition-transform hover:scale-110"
              style={{ left: `${Math.min(100, (reaction.timestamp / duration) * 100)}%` }}
              title={t("video.reactions.titleAt", { label: reactionLabel(reaction.emoji, t), name: reaction.viewerName ?? t("video.reactions.someone"), time: formatDuration(reaction.timestamp) })}
              aria-label={t("video.reactions.labelBy", { label: reactionLabel(reaction.emoji, t), name: reaction.viewerName ?? t("video.reactions.someone"), time: formatDuration(reaction.timestamp) })}
            >
              <ReactionIcon code={reaction.emoji} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoInfo({
  justRecorded,
  wordCount,
  hideSummary,
  upload,
  origin,
  author,
  views,
  likeCount,
  auth,
  showLike,
  mediaSource,
  isOwner,
  exportReady,
  aiPending,
  ctaLabel,
  ctaUrl,
  uploadId,
  currentTime,
  studioOpen,
  onToggleStudio,
  onNotify,
  canMakeGif,
  gifReady,
  ensureGif,
  replyId,
  onReplyChange,
}: {
  replyId: string | null;
  onReplyChange: (id: string | null) => void;
  justRecorded: boolean;
  wordCount: number;
  hideSummary: boolean;
  upload: Upload;
  origin: string;
  author: Author;
  views: number;
  likeCount: number;
  auth: AuthState;
  showLike: boolean;
  mediaSource: string;
  isOwner: boolean;
  exportReady: boolean;
  aiPending: boolean;
  ctaLabel: string | null;
  ctaUrl: string | null;
  uploadId: string;
  currentTime: number;
  studioOpen: boolean;
  onToggleStudio: () => void;
  onNotify: (message: string, variant?: "error") => void;
  canMakeGif: boolean;
  gifReady: boolean;
  ensureGif: () => Promise<boolean>;
}) {
  const t = useT();
  const language = useLanguage();
  const [title, setTitle] = useState(
    upload.title?.trim() || (aiPending ? t("video.info.naming") : t("video.common.untitled")),
  );
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The actions row sits near the bottom of the window, so the menu opens upward when there's no room below.
  const [shareUp, setShareUp] = useState(false);
  // On a narrow screen the button can sit near the left edge, where a right-aligned menu would be cut off.
  const [shareFromLeft, setShareFromLeft] = useState(false);
  const shareButton = useRef<HTMLDivElement>(null);
  const saveTitle = async (next: string) => {
    setEditing(false);
    const trimmed = next.trim();
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed);
    const response = await fetch(`/api/recordings/${upload.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    });
    if (!response.ok) onNotify(t("video.toast.renameFailed"), "error");
  };

  const metadata = [
    localizedTimeAgo(upload.createdAt, language, t),
    upload.duration ? formatDuration(upload.duration) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isOwner) void fetch(`/api/recordings/${upload.id}/shared`, { method: "POST" }).catch(() => {});
      onNotify(message);
    } catch {
      onNotify(t("video.share.couldntCopy"), "error");
    }
    setShareOpen(false);
  };
  const pageUrl = `${origin}/${upload.id}`;
  const at = Math.floor(currentTime);

  const setReplies = async (on: boolean) => {
    setShareOpen(false);
    const response = await fetch(`/api/recordings/${upload.id}/reply`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on }),
    }).catch(() => null);
    if (!response?.ok) return onNotify(t("video.reply.failed"), "error");
    onReplyChange(((await response.json()) as { replyRequestId: string | null }).replyRequestId);
    onNotify(t(on ? "video.reply.onToast" : "video.reply.offToast"));
  };

  return (
    <div className="flex flex-col">
      {editing ? (
        <input
          autoFocus
          defaultValue={title}
          maxLength={200}
          onBlur={(event) => void saveTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setEditing(false);
          }}
          className="w-full rounded-md border border-neutral-300 px-2 py-1 text-lg font-semibold text-neutral-900 lg:text-xl"
        />
      ) : (
        <h1
          className={`text-lg font-semibold text-neutral-900 lg:text-xl ${isOwner ? "cursor-text rounded hover:bg-neutral-100" : ""}`}
          title={isOwner ? t("video.info.clickToRename") : undefined}
          onClick={() => isOwner && setEditing(true)}
        >
          {title}
        </h1>
      )}
      {justRecorded && wordCount >= 20 && Boolean(upload.duration) && (
        <p className="mt-2 text-sm font-medium text-neutral-800">{t("video.info.receipt", { count: wordCount, time: formatDuration(upload.duration!) })}</p>
      )}
      {justRecorded && (
        <p className="mt-2 text-sm text-neutral-500">
          {t("video.info.needTheirs")}{" "}
          <a href="/home?request=1" className="font-medium text-red-600 hover:underline">{t("video.share.askToShow")}</a>
        </p>
      )}
      {replyId && !isOwner && (
        <p className="mt-3">
          <a href={`/request/${replyId}`} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-red-500">
            <VideoCameraIcon size={18} weight="fill" />
            {t("video.reply.button")}
          </a>
        </p>
      )}
      {upload.summary && !hideSummary && (
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-neutral-600">{upload.summary}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src={author.avatar} alt={author.name} className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0">
            <p className="font-medium text-neutral-900">{author.name}</p>
            <p className="text-xs text-neutral-500">{metadata}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm font-medium text-neutral-500">{localizedViews(views, language, t)}</span>
          {showLike && <LikeButton uploadId={upload.id} auth={auth} initialCount={likeCount} />}
          {auth.user && !isOwner && <WatchLaterButton uploadId={upload.id} />}
          {ctaLabel && ctaUrl && (
            <LinkButton href={ctaUrl} onClick={() => countCtaClick(uploadId)} target="_blank" rel="noopener noreferrer" variant="primary" icon={<ArrowSquareOutIcon weight="bold" />}>
              {ctaLabel}
            </LinkButton>
          )}
          <div ref={shareButton} className="relative">
            <Button
              variant="secondary"
              icon={<LinkIcon weight="bold" />}
              onClick={() => {
                const rect = shareButton.current?.getBoundingClientRect();
                if (rect) {
                  setShareUp(window.innerHeight - rect.bottom < 320 && rect.top > window.innerHeight - rect.bottom);
                  setShareFromLeft(rect.right < 248);
                }
                setShareOpen((open) => !open);
              }}
            >
              {t("video.action.share")}
            </Button>
            {shareOpen && (
              <div className={`pop-in absolute ${shareFromLeft ? "left-0" : "right-0"} z-30 max-h-[min(22rem,70dvh)] w-60 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-lg ${shareUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
                <MenuItem onClick={() => void copy(pageUrl, t("video.share.linkCopied"))}>{t("video.share.copyLink")}</MenuItem>
                {at > 0 && (
                  <MenuItem onClick={() => void copy(`${pageUrl}?t=${at}`, t("video.share.linkAtCopied", { time: formatDuration(at) }))}>
                    {t("video.share.copyLinkAt", { time: formatDuration(at) })}
                  </MenuItem>
                )}
                {(upload.posterKey || gifReady || canMakeGif) && (
                  <MenuItem
                    onClick={() => {
                      setShareOpen(false);
                      const safeTitle = title.replace(/"/g, "&quot;").replace(/</g, "&lt;");
                      let animated = false;
                      // A promised blob keeps the click's permission to write the clipboard while the GIF is made.
                      const html = ensureGif().then((made) => {
                        animated = made;
                        const image = `${origin}/api/${made ? "gif" : "poster"}/${upload.id}`;
                        return new Blob(
                          [`<a href="${pageUrl}"><img src="${image}" alt="${safeTitle}" width="480" style="border-radius:12px;max-width:100%"></a><br><a href="${pageUrl}">${t("video.share.watchLink", { title: safeTitle })}</a>`],
                          { type: "text/html" },
                        );
                      });
                      if (!gifReady && canMakeGif) onNotify(t("video.share.makingPreview"));
                      void navigator.clipboard
                        .write([new ClipboardItem({ "text/html": html, "text/plain": new Blob([pageUrl], { type: "text/plain" }) })])
                        .then(
                          () => onNotify(animated ? t("video.share.animatedCopied") : t("video.share.previewCopied")),
                          () => onNotify(t("video.share.couldntCopy"), "error"),
                        );
                    }}
                  >
                    {/* The self-hosted edition makes no GIF, so it only promises one for a video that already has it. */}
                    {HOSTED_EDITION || gifReady ? t("video.share.copyAnimated") : t("video.share.copyPreview")}
                    <span className="block text-xs font-normal text-neutral-500">
                      {HOSTED_EDITION || gifReady ? t("video.share.copyAnimatedHint") : t("video.share.copyPreviewHint")}
                    </span>
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    setShareOpen(false);
                    // A promised blob keeps the click's permission to write the clipboard while the brief loads.
                    const brief = fetch(`/api/prompt/${upload.id}`).then((response) => {
                      if (!response.ok) throw new Error("prompt failed");
                      return response.blob();
                    });
                    void navigator.clipboard
                      .write([new ClipboardItem({ "text/plain": brief.then((blob) => new Blob([blob], { type: "text/plain" })) })])
                      .then(
                        () => onNotify(t("video.share.agentCopied")),
                        () => onNotify(t("video.share.couldntCopy"), "error"),
                      );
                  }}
                >
                  {t("video.share.copyForAgent")}
                </MenuItem>
                {isOwner && <MenuItem onClick={() => window.location.assign("/home?request=1")}>{t("video.share.askToShow")}</MenuItem>}
                {isOwner && (
                  <MenuItem onClick={() => void setReplies(!replyId)}>
                    {t(replyId ? "video.reply.stop" : "video.reply.ask")}
                    {!replyId && <span className="block text-xs font-normal text-neutral-500">{t("video.reply.askHint")}</span>}
                  </MenuItem>
                )}
                <div className="mx-2 my-1 border-t border-neutral-200" />
                <p className="px-3 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">{t("video.share.embedHeading")}</p>
                <MenuItem
                  onClick={() =>
                    void copy(
                      `<div style="position:relative;padding-bottom:56.25%;height:0"><iframe src="${origin}/embed/${upload.id}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="fullscreen; picture-in-picture" allowfullscreen></iframe></div>`,
                      t("video.share.embedCopied"),
                    )
                  }
                >
                  {t("video.share.copyEmbed")}
                </MenuItem>
              </div>
            )}
          </div>
          {isOwner && <MoveButton uploadId={upload.id} onNotify={onNotify} />}
          {isOwner ? (
            <DownloadMenu uploadId={upload.id} mediaSource={mediaSource} filename={upload.filename} captions={Boolean(upload.transcriptKey)} preparing={upload.exportStatus === "pending"} onNotify={onNotify} />
          ) : upload.downloadsEnabled && (exportReady || !needsCopy(upload)) && (
            // Without a current render, an edited video has nothing to hand out: its recording still holds what was removed.
            <LinkButton
              href={exportReady ? `${origin}/api/export/${upload.id}` : mediaSource}
              download={exportReady ? undefined : upload.filename}
              variant="secondary"
              icon={<DownloadSimpleIcon weight="bold" />}
            >
              {t("video.action.download")}
            </LinkButton>
          )}
          {isOwner && (
            <Button
              variant={studioOpen ? "primary" : "secondary"}
              icon={studioOpen ? undefined : <SlidersHorizontalIcon weight="bold" />}
              onClick={() => { markGuide("customized"); onToggleStudio(); }}
            >
              {studioOpen ? t("video.action.done") : t("video.action.customize")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Owner download: the MP4 with the layout rendered in, or the raw screen track. */
function DownloadMenu({
  uploadId,
  mediaSource,
  filename,
  captions,
  preparing,
  onNotify,
}: {
  uploadId: string;
  mediaSource: string;
  filename: string;
  captions: boolean;
  /** An MP4 was already being made when the page loaded. */
  preparing: boolean;
  onNotify: (message: string, variant?: "error") => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // Like the share menu: the actions row sits near the bottom of the window, so open upward when there's no room below.
  const [openUp, setOpenUp] = useState(false);
  const [fromLeft, setFromLeft] = useState(false);
  const [rendering, setRendering] = useState(preparing);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => {
    if (!rendering || startedAt === null || !open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [rendering, startedAt, open]);

  /** A long video renders for hours, so keep asking while it is still rendering, less often as time goes on. */
  const follow = async (status: string | undefined) => {
    const started = Date.now();
    let current = status;
    while (current === "pending" && Date.now() - started < 24 * 60 * 60 * 1000) {
      await new Promise((resolve) => setTimeout(resolve, Date.now() - started < 5 * 60 * 1000 ? 4000 : 20_000));
      try {
        const response = await fetch(`/api/recordings/${uploadId}/export`);
        if (response.ok) current = (await response.json<{ status?: string }>()).status;
      } catch {
        // A dropped connection over a long wait: ask again.
      }
    }
    return current;
  };

  // Back on the page while a render is still going: show it, and say when it's ready without starting a download unasked.
  useEffect(() => {
    if (!preparing) return;
    void follow("pending").then((status) => {
      setRendering(false);
      if (status === "done") onNotify(t("video.download.ready"));
      else onNotify(t("video.download.renderFailed"), "error");
    });
  }, []);

  const exportVideo = async () => {
    setRendering(true);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const response = await fetch(`/api/recordings/${uploadId}/export`, { method: "POST" });
      const body = await response.json<{ status?: string; error?: string }>();
      if (response.status === 429) {
        onNotify(body.error ?? t("video.download.tooManyRenders"), "error");
        return;
      }
      if ((await follow(body.status)) === "done") {
        setOpen(false);
        window.location.href = `/api/export/${uploadId}`;
      } else onNotify(t("video.download.renderFailed"), "error");
    } catch {
      onNotify(t("video.download.renderFailed"), "error");
    } finally {
      setRendering(false);
      setStartedAt(null);
    }
  };

  return (
    <div ref={root} className="relative">
      <Button
        variant="secondary"
        icon={rendering ? <CircleNotchIcon weight="bold" className="animate-spin" /> : <DownloadSimpleIcon weight="bold" />}
        aria-expanded={open}
        onClick={() => {
          const rect = root.current?.getBoundingClientRect();
          if (rect) {
            setOpenUp(window.innerHeight - rect.bottom < 240 && rect.top > window.innerHeight - rect.bottom);
            setFromLeft(rect.right < 264);
          }
          setOpen((value) => !value);
        }}
      >
        {rendering ? t("video.download.renderingLabel") : t("video.action.download")}
      </Button>
      {open && (
        <div className={`pop-in absolute ${fromLeft ? "left-0" : "right-0"} z-30 w-64 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg ${openUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          {rendering ? (
            <div role="status" className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
              <span className="flex items-center gap-2 font-medium">
                <CircleNotchIcon weight="bold" className="shrink-0 animate-spin" />
                {t("video.download.preparing")}
                {startedAt !== null && <span className="ml-auto text-xs font-normal tabular-nums text-neutral-500">{formatDuration(Math.max(0, (now - startedAt) / 1000))}</span>}
              </span>
              <span className="mt-1 block text-xs text-neutral-500">{t("video.download.preparingHint")}</span>
            </div>
          ) : (
            <MenuItem onClick={() => void exportVideo()}>
              <span className="font-medium">{t("video.download.mp4")}</span>
              <span className="block text-xs text-neutral-500">{t("video.download.mp4Hint")}</span>
            </MenuItem>
          )}
          <a
            href={mediaSource}
            download={filename}
            onClick={() => setOpen(false)}
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
          >
            <span className="font-medium">{t("video.download.original")}</span>
            <span className="block text-xs text-neutral-500">{t("video.download.originalHint")}</span>
          </a>
          {captions && (
            <a
              href={`/api/captions/${uploadId}?format=srt`}
              onClick={() => setOpen(false)}
              className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span className="font-medium">{t("video.download.captions")}</span>
              <span className="block text-xs text-neutral-500">{t("video.download.captionsHint")}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-100"
    >
      {children}
    </button>
  );
}

function CurrentChapterIndicator({ chapter }: { chapter: Chapter }) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
        <span className="size-1.5 animate-pulse rounded-full bg-neutral-900" />
        {chapter.title}
      </span>
      <span className="font-mono text-xs text-neutral-400 tabular-nums">
        {formatDuration(chapter.startTime)}
      </span>
    </div>
  );
}
