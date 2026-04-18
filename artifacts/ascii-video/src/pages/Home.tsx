import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Play, Pause, RotateCcw, Download, Settings2, ChevronDown, ChevronUp, Video, Square, ArrowLeftRight, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAsciiRenderer } from "@/hooks/useAsciiRenderer";
import { ASCII_PRESETS, AsciiOptions, RenderMode, HalftoneShape, BitmapStyle, TileShape, TileColorMode, TILE_DENSITY_ORDER } from "@/lib/ascii";

const MAX_FILE_SIZE_MB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_CANVAS_WIDTH = 960;

interface FontOption {
  label: string;
  family: string;
  google: boolean;
  weights: number[];
  windowsOnly?: boolean;
}

const FONT_OPTIONS: FontOption[] = [
  { label: "JetBrains Mono", family: "JetBrains Mono", google: true,  weights: [300, 400, 500, 700, 800] },
  { label: "Fira Code",       family: "Fira Code",       google: true,  weights: [300, 400, 500, 600, 700] },
  { label: "Space Mono",      family: "Space Mono",      google: true,  weights: [400, 700] },
  { label: "Source Code Pro", family: "Source Code Pro", google: true,  weights: [300, 400, 500, 700, 900] },
  { label: "Roboto Mono",     family: "Roboto Mono",     google: true,  weights: [100, 300, 400, 500, 700] },
  { label: "Inconsolata",     family: "Inconsolata",     google: true,  weights: [300, 400, 500, 700, 900] },
  { label: "Ubuntu Mono",     family: "Ubuntu Mono",     google: true,  weights: [400, 700] },
  { label: "VT323",           family: "VT323",           google: true,  weights: [400] },
  { label: "Share Tech Mono", family: "Share Tech Mono", google: true,  weights: [400] },
  { label: "Courier New",     family: "Courier New",     google: false, weights: [400, 700] },
  { label: "Noto Symbols 2", family: "Noto Symbols 2",  google: true,  weights: [400] },
  { label: "Wingdings",      family: "Wingdings",       google: false, weights: [400], windowsOnly: true },
  { label: "Webdings",       family: "Webdings",        google: false, weights: [400], windowsOnly: true },
];

const loadedFonts = new Set<string>();

function detectIsWindowsHost(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData?.platform ?? "";
  const platform = uaPlatform || navigator.platform;
  return /win/i.test(platform);
}

const isWindowsHost = detectIsWindowsHost();

function loadGoogleFont(family: string, weights: number[]) {
  const key = `${family}-${weights.join(",")}`;
  if (loadedFonts.has(key)) return Promise.resolve();
  loadedFonts.add(key);
  const wStr = weights.join(";");
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${wStr}&display=swap`;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  return document.fonts.ready;
}

type FileMode = "video" | "image" | null;

const POSTERIZE_PRESETS: Record<string, string[]> = {
  Hope: ["#112f58", "#c8102e", "#d4b483", "#f0e6c8"],
  Mono: ["#111111", "#444444", "#aaaaaa", "#eeeeee"],
  Warm: ["#1a0500", "#8b2500", "#e8820a", "#ffd180"],
  Cool: ["#0a0a2e", "#1a3a6e", "#4a90d9", "#c8e6ff"],
};

const BAND_LABELS: Record<number, string[]> = {
  2: ["Shadow", "Highlight"],
  3: ["Shadow", "Midtone", "Highlight"],
  4: ["Shadow", "Dark", "Light", "Highlight"],
  5: ["Shadow", "Dark", "Midtone", "Light", "Highlight"],
  6: ["Shadow", "Dark Low", "Dark High", "Light Low", "Light High", "Highlight"],
};

function resizePosterizeColors(colors: string[], newCount: number): string[] {
  if (newCount <= colors.length) return colors.slice(0, newCount);
  const padded = [...colors];
  while (padded.length < newCount) padded.push(padded[padded.length - 1]);
  return padded;
}

function getCanvasDimensions(w: number, h: number) {
  if (!w || !h) return { width: MAX_CANVAS_WIDTH, height: 540 };
  const aspect = w / h;
  const width = Math.min(w, MAX_CANVAS_WIDTH);
  const height = Math.round(width / aspect);
  return { width, height };
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const [fileMode, setFileMode] = useState<FileMode>(null);
  const [mediaSrc, setMediaSrc] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [canvasDims, setCanvasDims] = useState({ width: MAX_CANVAS_WIDTH, height: 540 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);

  const [selectedPreset, setSelectedPreset] = useState("standard");
  const [customChars, setCustomChars] = useState(ASCII_PRESETS["standard"]);
  const [bgColor, setBgColor] = useState("#000000");
  const [textColor, setTextColor] = useState("#00ff41");
  const [fontSize, setFontSize] = useState(8);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [exposure, setExposure] = useState(0);
  const [gamma, setGamma] = useState(1);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [useMidColor, setUseMidColor] = useState(false);
  const [midColors, setMidColors] = useState<string[]>(["#888800"]);
  const [midColorStrict, setMidColorStrict] = useState(false);
  const midDragIndex = useRef<number | null>(null);
  const [renderMode, setRenderMode] = useState<RenderMode>("ascii");
  const [halftoneShape, setHalftoneShape] = useState<HalftoneShape>("circle");
  const [bitmapStyle, setBitmapStyle] = useState<BitmapStyle>("dithered");
  const [fontFamily, setFontFamily] = useState("Ubuntu Mono");
  const [fontWeight, setFontWeight] = useState(700);
  const [fontLoading, setFontLoading] = useState(false);
  const [invert, setInvert] = useState(false);
  const [useMosaicZones, setUseMosaicZones] = useState(false);
  const [mosaicZoneSize, setMosaicZoneSize] = useState(64);
  const [posterizeBands, setPosterizeBands] = useState(4);
  const [posterizeColors, setPosterizeColors] = useState<string[]>(POSTERIZE_PRESETS.Hope);
  const [posterizeCellSize, setPosterizeCellSize] = useState(1);
  const [posterizeSmooth, setPosterizeSmooth] = useState(0);
  const [posterizeBlend, setPosterizeBlend] = useState(0.10);
  const [tileShapes, setTileShapes] = useState<TileShape[]>(["ring"]);
  const [tileLineWidth, setTileLineWidth] = useState(0.15);
  const [tileColorMode, setTileColorMode] = useState<TileColorMode>("source");
  const [tileScaleWithBrightness, setTileScaleWithBrightness] = useState(false);

  const currentFontOption = FONT_OPTIONS.find((f) => f.family === fontFamily) ?? FONT_OPTIONS[0];

  const options: AsciiOptions = {
    chars: customChars,
    bgColor,
    textColor,
    fontSize,
    fontFamily,
    fontWeight,
    brightness,
    contrast,
    exposure,
    gamma,
    invert,
    startTime,
    endTime,
    useMidColor,
    midColors,
    midColorStrict,
    renderMode,
    halftoneShape,
    bitmapStyle,
    useMosaicZones,
    mosaicZoneSize,
    posterizeBands,
    posterizeColors,
    posterizeCellSize,
    posterizeSmooth,
    posterizeBlend,
    tileShapes,
    tileLineWidth,
    tileColorMode,
    tileScaleWithBrightness,
  };

  const { renderSingleFrame } = useAsciiRenderer({
    videoRef,
    outputCanvasRef,
    options,
    isPlaying,
  });

  const renderImage = useCallback(() => {
    if (imgRef.current) renderSingleFrame(imgRef.current);
  }, [renderSingleFrame]);

  const loadFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      setError("Please upload a video or image file.");
      return;
    }
    setError(null);
    if (mediaSrc) URL.revokeObjectURL(mediaSrc);
    const url = URL.createObjectURL(file);
    setMediaSrc(url);
    setFileMode(isImage ? "image" : "video");
    setIsPlaying(false);
    setCurrentTime(0);
    setStartTime(0);

    if (isImage) {
      const img = new Image();
      img.onload = () => {
        imgRef.current = img;
        const dims = getCanvasDimensions(img.naturalWidth, img.naturalHeight);
        setCanvasDims(dims);
        setTimeout(() => renderSingleFrame(img), 50);
      };
      img.src = url;
    }
  }, [mediaSrc, renderSingleFrame]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) loadFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleVideoLoaded = () => {
    const video = videoRef.current;
    if (!video) return;
    const dur = video.duration;
    setVideoDuration(dur);
    setEndTime(dur);
    const dims = getCanvasDimensions(video.videoWidth, video.videoHeight);
    setCanvasDims(dims);
    video.currentTime = 0;
    setTimeout(renderSingleFrame, 50);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);

    if (isRecording && videoDuration > 0) {
      const duration = endTime - startTime;
      const elapsed = t - startTime;
      setRecordingProgress(Math.min(100, (elapsed / duration) * 100));
    }

    if (endTime > 0 && t >= endTime) {
      video.pause();
      setIsPlaying(false);
      if (isRecording) stopRecording();
      else video.currentTime = startTime;
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      if (video.currentTime >= endTime) video.currentTime = startTime;
      video.play();
      setIsPlaying(true);
    }
  };

  const handleReset = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = startTime;
    setIsPlaying(false);
    setTimeout(renderSingleFrame, 50);
  };

  const handleResetAllSettings = () => {
    setSelectedPreset("standard");
    setCustomChars(ASCII_PRESETS["standard"]);
    setBgColor("#000000");
    setTextColor("#00ff41");
    setFontSize(8);
    setBrightness(100);
    setContrast(100);
    setExposure(0);
    setGamma(1);
    setInvert(false);
    setUseMidColor(false);
    setMidColors(["#888800"]);
    setMidColorStrict(false);
    setFontFamily("Ubuntu Mono");
    setFontWeight(700);
    setUseMosaicZones(false);
    setMosaicZoneSize(64);
    setHalftoneShape("circle");
    setBitmapStyle("dithered");
    setPosterizeBands(4);
    setPosterizeColors(POSTERIZE_PRESETS.Hope);
    setPosterizeCellSize(1);
    setPosterizeSmooth(0);
    setPosterizeBlend(0.10);
    setTileShapes(["ring"]);
    setTileLineWidth(0.15);
    setTileColorMode("source");
    setTileScaleWithBrightness(false);
  };

  const handleSeek = (vals: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = vals[0];
    setCurrentTime(vals[0]);
    renderSingleFrame();
  };

  const handlePresetChange = (preset: string) => {
    setSelectedPreset(preset);
    setCustomChars(ASCII_PRESETS[preset]);
  };

  const handleCustomCharsChange = (val: string) => {
    setSelectedPreset("custom");
    setCustomChars(val);
  };

  const handleStartTimeChange = (vals: number[]) => {
    const t = vals[0];
    setStartTime(t);
    if (t >= endTime) setEndTime(Math.min(t + 0.1, videoDuration));
  };

  const handleEndTimeChange = (vals: number[]) => {
    const t = vals[0];
    setEndTime(t);
    if (t <= startTime) setStartTime(Math.max(t - 0.1, 0));
  };

  const handleDownloadFrame = () => {
    const canvas = outputCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = fileMode === "image" ? "ascii-image.png" : "ascii-frame.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (!mr || mr.state === "inactive") return;
    mr.stop();
  }, []);

  const startRecording = () => {
    const video = videoRef.current;
    const canvas = outputCanvasRef.current;
    if (!video || !canvas) return;

    recordedChunksRef.current = [];
    setRecordingProgress(0);

    const stream = canvas.captureStream(30);
    const mimeTypes = [
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=h264",
      "video/webm;codecs=vp9",
      "video/webm",
    ];
    const supportedMime = mimeTypes.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const ext = supportedMime.startsWith("video/mp4") ? "mp4" : "webm";

    const mr = new MediaRecorder(stream, { mimeType: supportedMime });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    mr.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: supportedMime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `ascii-video.${ext}`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      setIsRecording(false);
      setRecordingProgress(0);
    };

    mr.start(100);
    setIsRecording(true);
    video.currentTime = startTime;
    video.play();
    setIsPlaying(true);
  };

  const handleCancelRecording = () => {
    const video = videoRef.current;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      mr.ondataavailable = null;
      mr.onstop = () => { setIsRecording(false); setRecordingProgress(0); };
      mr.stop();
    }
    video?.pause();
    setIsPlaying(false);
  };

  const swapColors = () => {
    setBgColor(textColor);
    setTextColor(bgColor);
  };

  useEffect(() => {
    if (fileMode === "image") {
      renderImage();
    } else {
      renderSingleFrame();
    }
  }, [bgColor, textColor, midColors, useMidColor, midColorStrict, fontSize, fontFamily, fontWeight, customChars, brightness, contrast, exposure, gamma, invert, fileMode, renderMode, halftoneShape, bitmapStyle, useMosaicZones, mosaicZoneSize, posterizeBands, posterizeColors, posterizeCellSize, posterizeSmooth, posterizeBlend, tileShapes, tileLineWidth, tileColorMode, tileScaleWithBrightness, renderSingleFrame, renderImage]);

  useEffect(() => {
    loadGoogleFont("Noto Symbols 2", [400]);
  }, []);

  useEffect(() => {
    if (!currentFontOption.google) return;
    setFontLoading(true);
    loadGoogleFont(currentFontOption.family, currentFontOption.weights).then(() => {
      setFontLoading(false);
      if (fileMode === "image") {
        if (imgRef.current) renderSingleFrame(imgRef.current);
      } else {
        renderSingleFrame();
      }
    });
  }, [fontFamily]);

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const hasMedia = mediaSrc !== null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex-1 flex flex-col gap-4 min-w-0">
          {!hasMedia ? (
            <div
              data-testid="upload-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center gap-4 cursor-pointer
                transition-all duration-200 min-h-[400px]
                ${isDragging
                  ? "border-primary bg-accent/30 scale-[1.01]"
                  : "border-border bg-card hover:border-primary/50 hover:bg-accent/10"
                }
              `}
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <Video className="w-7 h-7" />
                </div>
                <div className="w-8 h-px bg-border" />
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                  <ImageIcon className="w-7 h-7" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">Drop a video or image here</p>
                <p className="text-muted-foreground text-sm mt-1">or click to browse</p>
                <p className="text-muted-foreground text-xs mt-2">Videos: MP4, WebM, MOV, AVI · Images: PNG, JPG, GIF, WebP — max {MAX_FILE_SIZE_MB} MB</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,image/*"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-file"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="relative rounded-xl overflow-hidden bg-black border border-border shadow-lg">
                <canvas
                  ref={outputCanvasRef}
                  width={canvasDims.width}
                  height={canvasDims.height}
                  className="w-full block"
                  data-testid="canvas-output"
                />
                {fileMode === "video" && (
                  <video
                    ref={videoRef}
                    src={mediaSrc!}
                    className="hidden"
                    onLoadedMetadata={handleVideoLoaded}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={() => { setIsPlaying(false); if (isRecording) stopRecording(); }}
                    playsInline
                    crossOrigin="anonymous"
                  />
                )}

                {isRecording && (
                  <div className="absolute top-3 left-3 right-3 flex items-center gap-2">
                    <div className="flex-1 bg-black/60 rounded-full h-2 overflow-hidden backdrop-blur-sm">
                      <div
                        className="h-full bg-red-500 transition-all duration-300"
                        style={{ width: `${recordingProgress}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1.5 bg-black/70 text-red-400 text-xs px-2 py-1 rounded-full backdrop-blur-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      REC
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 bg-card rounded-xl border border-border p-3 shadow-sm flex-wrap">
                {fileMode === "video" && (
                  <>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={togglePlay}
                      disabled={isRecording}
                      data-testid="button-play-pause"
                      className="w-9 h-9 p-0"
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReset}
                      disabled={isRecording}
                      data-testid="button-reset"
                      className="w-9 h-9 p-0"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                    <span className="text-xs font-mono text-muted-foreground ml-1">
                      {formatTime(currentTime)} / {formatTime(videoDuration)}
                    </span>
                  </>
                )}

                {fileMode === "image" && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5" />
                    Image
                  </span>
                )}

                <div className="flex-1" />

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadFrame}
                  disabled={isRecording}
                  data-testid="button-download-frame"
                  className="gap-1.5 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  {fileMode === "image" ? "Save image" : "Save frame"}
                </Button>

                {fileMode === "video" && (
                  isRecording ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleCancelRecording}
                      data-testid="button-stop-recording"
                      className="gap-1.5 text-xs"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={startRecording}
                      data-testid="button-record-video"
                      className="gap-1.5 text-xs text-primary border-primary/30 hover:bg-primary/5"
                    >
                      <Video className="w-3.5 h-3.5" />
                      Export video
                    </Button>
                  )
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isRecording}
                  data-testid="button-change-file"
                  className="text-xs text-muted-foreground"
                >
                  Change file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*,image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              {fileMode === "video" && !isRecording && (
                <div className="px-1">
                  <Slider
                    min={0}
                    max={videoDuration}
                    step={0.01}
                    value={[currentTime]}
                    onValueChange={handleSeek}
                    className="w-full"
                    data-testid="slider-seek"
                  />
                </div>
              )}

              {isRecording && (
                <div className="text-xs text-muted-foreground bg-card border border-border rounded-lg px-3 py-2 flex items-center gap-2" data-testid="text-recording-info">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  Recording in progress — the video will download automatically when done. Do not change settings while recording.
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-3" data-testid="text-error">
              {error}
            </div>
          )}
        </div>

        <div className="lg:w-80 xl:w-96 flex flex-col gap-3 flex-shrink-0">
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent/20 transition-colors"
              data-testid="button-toggle-settings"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="w-4 h-4 text-primary" />
                Options
              </span>
              {settingsOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>

            {settingsOpen && (
              <div className="px-4 pb-4 flex flex-col gap-5 border-t border-border pt-4">
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Render Mode</Label>
                  <div className="flex rounded-lg border border-border overflow-hidden" data-testid="render-mode-toggle">
                    {([
                      { value: "ascii", label: "ASCII" },
                      { value: "halftone", label: "Halftone" },
                      { value: "bitmap", label: "Bitmap" },
                      { value: "posterize", label: "Posterize" },
                      { value: "tiles", label: "Tiles" },
                    ] as { value: RenderMode; label: string }[]).map((mode) => (
                      <button
                        key={mode.value}
                        onClick={() => setRenderMode(mode.value)}
                        className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                          renderMode === mode.value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                        }`}
                        data-testid={`button-mode-${mode.value}`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {renderMode === "ascii" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Character Set</Label>
                      <Select value={selectedPreset} onValueChange={handlePresetChange} data-testid="select-preset">
                        <SelectTrigger className="text-sm" data-testid="select-trigger-preset">
                          <SelectValue placeholder="Select preset" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(ASCII_PRESETS).map((key) => {
                            const chars = ASCII_PRESETS[key];
                            const preview = chars.length > 22 ? chars.slice(0, 22) + "…" : chars;
                            return (
                              <SelectItem key={key} value={key} className="text-sm capitalize">
                                <span className="flex flex-col gap-0.5">
                                  <span>{key.charAt(0).toUpperCase() + key.slice(1)}</span>
                                  <span
                                    className="text-xs text-muted-foreground tracking-widest normal-case"
                                    style={{ fontFamily: "'Noto Symbols 2', 'Courier New', monospace" }}
                                  >{preview}</span>
                                </span>
                              </SelectItem>
                            );
                          })}
                          {selectedPreset === "custom" && (
                            <SelectItem value="custom" className="text-sm">Custom</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <Textarea
                        value={customChars}
                        onChange={(e) => handleCustomCharsChange(e.target.value)}
                        className="font-mono text-xs resize-none h-16 leading-snug"
                        placeholder="Enter characters (brightest to darkest)"
                        data-testid="textarea-chars"
                      />
                      <p className="text-xs text-muted-foreground">Characters ordered from brightest to darkest</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Font Family {fontLoading && <span className="text-primary ml-1 normal-case font-normal">loading…</span>}
                      </Label>
                      <Select
                        value={fontFamily}
                        onValueChange={(fam) => {
                          const opt = FONT_OPTIONS.find((f) => f.family === fam)!;
                          setFontFamily(fam);
                          if (!opt.weights.includes(fontWeight)) setFontWeight(opt.weights.includes(400) ? 400 : opt.weights[0]);
                        }}
                        data-testid="select-font-family"
                      >
                        <SelectTrigger className="text-sm" data-testid="select-trigger-font">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FONT_OPTIONS.map((f) => (
                            <SelectItem key={f.family} value={f.family} className="text-sm">
                              {f.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {currentFontOption.windowsOnly && !isWindowsHost && (
                        <p className="text-xs text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md px-2.5 py-1.5 leading-snug" data-testid="windows-font-warning">
                          <span className="font-semibold">{currentFontOption.label}</span> is a Windows-only font and may not render correctly on macOS or Linux — you may see blank or incorrect output. Try{" "}
                          <button
                            className="underline font-medium hover:text-amber-400 transition-colors"
                            onClick={() => { setFontFamily("Noto Symbols 2"); setFontWeight(400); }}
                          >
                            Noto Symbols 2
                          </button>{" "}
                          as a cross-platform alternative.
                        </p>
                      )}

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs text-muted-foreground">Weight</Label>
                        <div className="flex gap-1 flex-wrap" data-testid="font-weight-picker">
                          {currentFontOption.weights.map((w) => (
                            <button
                              key={w}
                              onClick={() => setFontWeight(w)}
                              data-testid={`button-weight-${w}`}
                              className={`px-2 py-1 rounded text-xs border transition-colors ${
                                fontWeight === w
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                              }`}
                              style={{ fontWeight: w }}
                            >
                              {w === 100 ? "Thin" : w === 200 ? "ExLight" : w === 300 ? "Light" : w === 400 ? "Regular" : w === 500 ? "Medium" : w === 600 ? "SemiBold" : w === 700 ? "Bold" : w === 800 ? "ExBold" : "Black"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {renderMode === "halftone" && (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shape</Label>
                      <div className="grid grid-cols-3 gap-1.5" data-testid="halftone-shape-picker">
                        {([
                          { value: "circle", label: "Circles", icon: "●" },
                          { value: "square", label: "Squares", icon: "■" },
                          { value: "hexagon", label: "Hexagons", icon: "⬡" },
                        ] as { value: HalftoneShape; label: string; icon: string }[]).map((s) => (
                          <button
                            key={s.value}
                            onClick={() => setHalftoneShape(s.value)}
                            data-testid={`button-shape-${s.value}`}
                            className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-colors ${
                              halftoneShape === s.value
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                            }`}
                          >
                            <span className="text-lg leading-none">{s.icon}</span>
                            <span>{s.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                  </>
                )}

                {renderMode === "bitmap" && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Style</Label>
                    <div className="grid grid-cols-3 gap-1.5" data-testid="bitmap-style-picker">
                      {([
                        { value: "color", label: "Color", icon: "🎨", desc: "Real colours" },
                        { value: "mono", label: "Mono", icon: "◼", desc: "Hard threshold" },
                        { value: "dithered", label: "Dithered", icon: "▦", desc: "Bayer matrix" },
                      ] as { value: BitmapStyle; label: string; icon: string; desc: string }[]).map((s) => (
                        <button
                          key={s.value}
                          onClick={() => setBitmapStyle(s.value)}
                          data-testid={`button-bitmap-${s.value}`}
                          className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-colors ${
                            bitmapStyle === s.value
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          <span className="text-lg leading-none">{s.icon}</span>
                          <span>{s.label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {bitmapStyle === "color" && "Each pixel block shows its actual sampled colour."}
                      {bitmapStyle === "mono" && "Pixels brighter than 50% become text colour; the rest stay background."}
                      {bitmapStyle === "dithered" && "Bayer ordered dithering — classic 1-bit newspaper effect using your bg and text colours."}
                    </p>
                  </div>
                )}

                {renderMode === "posterize" && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colour Bands</Label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-foreground">{posterizeBands}</span>
                          <button
                            onClick={() => {
                              setPosterizeBands(4);
                              setPosterizeColors((prev) => resizePosterizeColors(prev, 4));
                            }}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                            data-testid="button-reset-posterize-bands"
                          >
                            reset
                          </button>
                        </div>
                      </div>
                      <Slider
                        min={2}
                        max={6}
                        step={1}
                        value={[posterizeBands]}
                        onValueChange={(v) => {
                          const n = v[0];
                          setPosterizeBands(n);
                          setPosterizeColors((prev) => resizePosterizeColors(prev, n));
                        }}
                        data-testid="slider-posterize-bands"
                      />
                      <p className="text-xs text-muted-foreground">Number of flat luminance zones — 4 recreates the Hope poster look</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cell Size</Label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-foreground">{posterizeCellSize}px</span>
                          <button
                            onClick={() => setPosterizeCellSize(1)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                            data-testid="button-reset-posterize-cell-size"
                          >
                            reset
                          </button>
                        </div>
                      </div>
                      <Slider
                        min={1}
                        max={32}
                        step={1}
                        value={[posterizeCellSize]}
                        onValueChange={(v) => setPosterizeCellSize(v[0])}
                        data-testid="slider-posterize-cell-size"
                      />
                      <p className="text-xs text-muted-foreground">1px = full resolution (smoothest shapes); higher = chunky blocks</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cluster merge</Label>
                        <span className="text-xs font-mono text-foreground">{posterizeSmooth}</span>
                      </div>
                      <Slider
                        min={0}
                        max={8}
                        step={1}
                        value={[posterizeSmooth]}
                        onValueChange={(v) => setPosterizeSmooth(v[0])}
                        data-testid="slider-posterize-smooth"
                      />
                      <p className="text-xs text-muted-foreground">0 = off; higher = merges small isolated colour patches — edges stay sharp</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Edge softness</Label>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-mono text-foreground">{posterizeBlend.toFixed(2)}</span>
                          <button
                            onClick={() => setPosterizeBlend(0.10)}
                            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                            data-testid="button-reset-posterize-blend"
                          >
                            reset
                          </button>
                        </div>
                      </div>
                      <Slider
                        min={0}
                        max={0.4}
                        step={0.02}
                        value={[posterizeBlend]}
                        onValueChange={(v) => setPosterizeBlend(v[0])}
                        data-testid="slider-posterize-blend"
                      />
                      <p className="text-xs text-muted-foreground">0 = hard cut between bands; higher = wider smooth transition</p>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Presets</Label>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {Object.entries(POSTERIZE_PRESETS).map(([name, colors]) => (
                          <button
                            key={name}
                            onClick={() => {
                              setPosterizeColors(resizePosterizeColors(colors, posterizeBands));
                            }}
                            data-testid={`button-posterize-preset-${name.toLowerCase()}`}
                            className="px-2.5 py-1 rounded text-xs border border-border hover:border-primary/50 transition-colors"
                            style={{
                              background: `linear-gradient(to right, ${colors.join(", ")})`,
                              color: "#fff",
                              textShadow: "0 1px 2px rgba(0,0,0,0.7)",
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Band Colours</Label>
                      <p className="text-xs text-muted-foreground -mt-1">Shadow (darkest) → Highlight (brightest)</p>
                      <div className="flex flex-col gap-2">
                        {posterizeColors.map((color, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="color"
                              value={color}
                              onChange={(e) => {
                                const next = [...posterizeColors];
                                next[i] = e.target.value;
                                setPosterizeColors(next);
                              }}
                              className="w-8 h-8 rounded cursor-pointer border border-border flex-shrink-0"
                              data-testid={`input-posterize-color-${i}`}
                            />
                            <Input
                              value={color}
                              onChange={(e) => {
                                const next = [...posterizeColors];
                                next[i] = e.target.value;
                                setPosterizeColors(next);
                              }}
                              className="font-mono text-xs h-8 min-w-0"
                              data-testid={`input-posterize-color-text-${i}`}
                            />
                            <span className="text-xs text-muted-foreground w-20 flex-shrink-0">
                              {(BAND_LABELS[posterizeBands] ?? [])[i] ?? `Band ${i + 1}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {renderMode === "tiles" && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shapes</Label>
                        <span className="text-xs text-muted-foreground">dark → dense · bright → sparse</span>
                      </div>

                      {/* Auto preset */}
                      <button
                        onClick={() => setTileShapes(["solid", "x", "cross", "ring", "diamond"])}
                        data-testid="button-tile-shape-auto"
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${
                          JSON.stringify([...tileShapes].sort()) === JSON.stringify(["cross", "diamond", "ring", "solid", "x"])
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-dashed border-primary/40 text-primary/70 hover:border-primary hover:text-primary hover:bg-primary/5"
                        }`}
                      >
                        <span className="font-medium">Auto — vary by brightness</span>
                        <span className="font-mono tracking-wider opacity-80">■ × + ○ ◇</span>
                      </button>

                      {/* Shape picker — grouped */}
                      {(() => {
                        const groups: { label: string; cols: number; shapes: { value: TileShape; label: string; icon: string }[] }[] = [
                          {
                            label: "Filled", cols: 4,
                            shapes: [
                              { value: "solid",          label: "Solid",    icon: "■" },
                              { value: "circle-filled",  label: "Circle",   icon: "●" },
                              { value: "diamond-filled", label: "Diamond",  icon: "◆" },
                              { value: "square-outline", label: "Sq. Out",  icon: "◻" },
                            ],
                          },
                          {
                            label: "Lines", cols: 3,
                            shapes: [
                              { value: "ring",      label: "Ring",      icon: "○" },
                              { value: "cross",     label: "Cross",     icon: "+" },
                              { value: "x",         label: "X",         icon: "×" },
                              { value: "slash",     label: "Slash",     icon: "/" },
                              { value: "backslash", label: "Backslash", icon: "\\" },
                              { value: "diamond",   label: "Diamond",   icon: "◇" },
                            ],
                          },
                          {
                            label: "Corner triangles", cols: 4,
                            shapes: [
                              { value: "tri-tl", label: "Top-left",     icon: "◤" },
                              { value: "tri-tr", label: "Top-right",    icon: "◥" },
                              { value: "tri-br", label: "Bot-right",    icon: "◢" },
                              { value: "tri-bl", label: "Bot-left",     icon: "◣" },
                            ],
                          },
                          {
                            label: "Center triangles", cols: 4,
                            shapes: [
                              { value: "tri-apex-t", label: "▲ Top",    icon: "▲" },
                              { value: "tri-apex-b", label: "▼ Bottom", icon: "▼" },
                              { value: "tri-apex-l", label: "◀ Left",   icon: "◀" },
                              { value: "tri-apex-r", label: "▶ Right",  icon: "▶" },
                            ],
                          },
                          {
                            label: "Half triangles", cols: 4,
                            shapes: [
                              { value: "tri-htl-h", label: "TL ½→", icon: "◤" },
                              { value: "tri-htl-v", label: "TL ½↓", icon: "◤" },
                              { value: "tri-htr-h", label: "TR ½←", icon: "◥" },
                              { value: "tri-htr-v", label: "TR ½↓", icon: "◥" },
                              { value: "tri-hbr-h", label: "BR ½←", icon: "◢" },
                              { value: "tri-hbr-v", label: "BR ½↑", icon: "◢" },
                              { value: "tri-hbl-h", label: "BL ½→", icon: "◣" },
                              { value: "tri-hbl-v", label: "BL ½↑", icon: "◣" },
                            ],
                          },
                        ];
                        const colClass: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-4" };
                        return (
                          <div className="flex flex-col gap-3" data-testid="tile-shape-picker">
                            {groups.map((g) => (
                              <div key={g.label} className="flex flex-col gap-1">
                                <p className="text-[10px] uppercase tracking-wide font-medium text-muted-foreground/70">{g.label}</p>
                                <div className={`grid ${colClass[g.cols] ?? "grid-cols-4"} gap-1.5`}>
                                  {g.shapes.map((s) => {
                                    const selected = tileShapes.includes(s.value);
                                    return (
                                      <button
                                        key={s.value}
                                        onClick={() => {
                                          if (selected) {
                                            if (tileShapes.length === 1) return;
                                            setTileShapes(tileShapes.filter((v) => v !== s.value));
                                          } else {
                                            setTileShapes([...tileShapes, s.value]);
                                          }
                                        }}
                                        data-testid={`button-tile-shape-${s.value}`}
                                        aria-pressed={selected}
                                        className={`relative flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-colors ${
                                          selected
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                        }`}
                                      >
                                        {selected && (
                                          <span className="absolute top-1 right-1 text-[8px] leading-none text-primary">✓</span>
                                        )}
                                        <span className="text-lg leading-none">{s.icon}</span>
                                        <span>{s.label}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      {tileShapes.length === 1 ? (
                        <p className="text-xs text-muted-foreground">Select multiple shapes to map different ones to brightness zones, or use Auto above</p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <p className="text-xs text-muted-foreground">{tileShapes.length} shapes — each covers an equal brightness band:</p>
                          <div className="flex rounded overflow-hidden border border-border text-[10px] font-mono leading-none" data-testid="tile-band-preview">
                            {TILE_DENSITY_ORDER.filter((s) => tileShapes.includes(s)).map((shape, i, arr) => {
                              const lo = Math.round((i / arr.length) * 100);
                              const hi = Math.round(((i + 1) / arr.length) * 100);
                              const icons: Record<string, string> = {
                                solid: "■", "circle-filled": "●", "diamond-filled": "◆", "square-outline": "◻",
                                ring: "○", cross: "+", x: "×", slash: "/", backslash: "\\", diamond: "◇",
                                "tri-tl": "◤", "tri-tr": "◥", "tri-br": "◢", "tri-bl": "◣",
                                "tri-apex-t": "▲", "tri-apex-b": "▼", "tri-apex-l": "◀", "tri-apex-r": "▶",
                                "tri-htl-h": "◤½→", "tri-htl-v": "◤½↓", "tri-htr-h": "◥½←", "tri-htr-v": "◥½↓",
                                "tri-hbr-h": "◢½←", "tri-hbr-v": "◢½↑", "tri-hbl-h": "◣½→", "tri-hbl-v": "◣½↑",
                              };
                              return (
                                <div
                                  key={shape}
                                  title={`${lo}–${hi}%`}
                                  className="flex-1 flex flex-col items-center gap-0.5 py-1 bg-muted/30 border-r border-border last:border-r-0"
                                >
                                  <span className="text-foreground">{icons[shape]}</span>
                                  <span className="text-muted-foreground">{lo}%</span>
                                </div>
                              );
                            })}
                          </div>
                          <p className="text-[10px] text-muted-foreground">Darkest areas use the leftmost shape, brightest use the rightmost</p>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colour source</Label>
                      <div className="flex rounded-lg border border-border overflow-hidden" data-testid="tile-color-mode-toggle">
                        {([
                          { value: "source", label: "Image colours" },
                          { value: "theme",  label: "Theme colours" },
                        ] as { value: TileColorMode; label: string }[]).map((m) => (
                          <button
                            key={m.value}
                            onClick={() => setTileColorMode(m.value)}
                            data-testid={`button-tile-color-${m.value}`}
                            className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                              tileColorMode === m.value
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                            }`}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {tileColorMode === "source"
                          ? "Each shape is drawn in its actual pixel colour from the source"
                          : "Shapes use your background / text / midtone colour palette"}
                      </p>
                    </div>

                    {(() => {
                      const FILLED: TileShape[] = [
                        "solid", "circle-filled", "diamond-filled",
                        "tri-tl", "tri-tr", "tri-br", "tri-bl",
                        "tri-apex-t", "tri-apex-b", "tri-apex-l", "tri-apex-r",
                        "tri-htl-h", "tri-htl-v", "tri-htr-h", "tri-htr-v",
                        "tri-hbr-h", "tri-hbr-v", "tri-hbl-h", "tri-hbl-v",
                      ];
                      return !tileShapes.every((s) => FILLED.includes(s));
                    })() && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line weight</Label>
                          <span className="text-xs font-mono text-foreground">{(tileLineWidth * 100).toFixed(0)}%</span>
                        </div>
                        <Slider
                          min={0.05}
                          max={0.45}
                          step={0.05}
                          value={[tileLineWidth]}
                          onValueChange={(v) => setTileLineWidth(v[0])}
                          data-testid="slider-tile-line-width"
                        />
                        <p className="text-xs text-muted-foreground">Stroke thickness as a proportion of the cell size</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <div>
                        <Label className="text-xs text-foreground">Scale with brightness</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {tileScaleWithBrightness
                            ? "Dark areas draw large shapes; bright areas draw small ones"
                            : "Each shape fills its full cell regardless of brightness"}
                        </p>
                      </div>
                      <button
                        onClick={() => setTileScaleWithBrightness((v) => !v)}
                        data-testid="button-toggle-tile-scale"
                        className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-3 ${tileScaleWithBrightness ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${tileScaleWithBrightness ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>
                )}

                {(renderMode === "halftone" || renderMode === "bitmap") && (
                  <div className="flex flex-col gap-2 pt-1 border-t border-border">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label className="text-xs text-foreground">Mosaic zones</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {useMosaicZones
                            ? `Image divided into ${mosaicZoneSize}px blocks — all cells share their block's average ${renderMode === "halftone" ? "brightness" : "colour"}`
                            : "Group cells into large blocks sharing one averaged value"}
                        </p>
                      </div>
                      <button
                        onClick={() => setUseMosaicZones((v) => !v)}
                        data-testid="button-toggle-mosaic"
                        className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-3 ${useMosaicZones ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${useMosaicZones ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                    <div className={`flex items-center gap-3 transition-opacity ${useMosaicZones ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
                      <Slider
                        min={8}
                        max={192}
                        step={8}
                        value={[mosaicZoneSize]}
                        onValueChange={(v) => setMosaicZoneSize(v[0])}
                        className="flex-1"
                        data-testid="slider-mosaic-zone"
                      />
                      <span className="text-xs font-mono w-10 text-right text-foreground">{mosaicZoneSize}px</span>
                    </div>
                  </div>
                )}

                {renderMode !== "posterize" && (
                <div className="flex flex-col gap-3">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colors</Label>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-foreground">Background</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border border-border flex-shrink-0"
                          data-testid="input-bg-color"
                        />
                        <Input
                          value={bgColor}
                          onChange={(e) => setBgColor(e.target.value)}
                          className="font-mono text-xs h-8 min-w-0"
                          data-testid="input-bg-color-text"
                        />
                      </div>
                    </div>

                    <button
                      onClick={swapColors}
                      title="Swap colors"
                      data-testid="button-swap-colors"
                      className="w-7 h-8 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-accent/20 transition-colors flex-shrink-0 mb-0.5"
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-foreground">Text / Chars</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer border border-border flex-shrink-0"
                          data-testid="input-text-color"
                        />
                        <Input
                          value={textColor}
                          onChange={(e) => setTextColor(e.target.value)}
                          className="font-mono text-xs h-8 min-w-0"
                          data-testid="input-text-color-text"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "Matrix", bg: "#000000", text: "#00ff41" },
                      { label: "Amber", bg: "#0a0800", text: "#ffb000" },
                      { label: "White", bg: "#ffffff", text: "#1a1a1a" },
                      { label: "Cyan", bg: "#000d14", text: "#00eaff" },
                      { label: "Purple", bg: "#0a0014", text: "#cc88ff" },
                    ].map((theme) => (
                      <button
                        key={theme.label}
                        onClick={() => { setBgColor(theme.bg); setTextColor(theme.text); }}
                        className="px-2 py-1 rounded text-xs border border-border hover:border-primary/50 transition-colors"
                        style={{ background: theme.bg, color: theme.text }}
                        data-testid={`button-theme-${theme.label.toLowerCase()}`}
                      >
                        {theme.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-col gap-2 pt-1">
                    {/* Master toggle */}
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground">Midtone colors</Label>
                      <button
                        onClick={() => setUseMidColor((v) => !v)}
                        data-testid="button-toggle-midcolor"
                        className={`relative w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none flex-shrink-0 ${useMidColor ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${useMidColor ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>

                    {useMidColor && (
                      <>
                        {/* Gradient preview strip */}
                        <div
                          className="h-3 w-full rounded-full border border-border"
                          style={{
                            background: `linear-gradient(to right, ${bgColor}, ${midColors.join(", ")}, ${textColor})`,
                          }}
                        />

                        {/* Midtone rows — draggable */}
                        <div className="flex flex-col gap-1.5">
                          {midColors.map((color, i) => (
                            <div
                              key={i}
                              draggable
                              onDragStart={() => { midDragIndex.current = i; }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                const from = midDragIndex.current;
                                midDragIndex.current = null;
                                if (from === null || from === i) return;
                                const next = [...midColors];
                                const [moved] = next.splice(from, 1);
                                next.splice(i, 0, moved);
                                setMidColors(next);
                              }}
                              onDragEnd={() => { midDragIndex.current = null; }}
                              data-testid={`midcolor-row-${i}`}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-border bg-muted/20 cursor-grab active:cursor-grabbing select-none"
                            >
                              {/* drag handle */}
                              <span className="text-muted-foreground text-sm leading-none">⠿</span>
                              {/* colour swatch */}
                              <input
                                type="color"
                                value={color}
                                onChange={(e) => {
                                  const next = [...midColors];
                                  next[i] = e.target.value;
                                  setMidColors(next);
                                }}
                                className="w-7 h-7 rounded cursor-pointer border border-border flex-shrink-0"
                                data-testid={`input-mid-color-${i}`}
                              />
                              {/* hex input */}
                              <Input
                                value={color}
                                onChange={(e) => {
                                  const next = [...midColors];
                                  next[i] = e.target.value;
                                  setMidColors(next);
                                }}
                                className="font-mono text-xs h-7 min-w-0 flex-1"
                                data-testid={`input-mid-color-text-${i}`}
                              />
                              {/* label */}
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                mid {midColors.length > 1 ? i + 1 : ""}
                              </span>
                              {/* remove */}
                              {midColors.length > 1 && (
                                <button
                                  onClick={() => setMidColors(midColors.filter((_, j) => j !== i))}
                                  data-testid={`button-remove-midcolor-${i}`}
                                  className="text-muted-foreground hover:text-destructive transition-colors text-sm leading-none px-0.5"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Add midtone button */}
                        {midColors.length < 3 && (
                          <button
                            onClick={() => setMidColors([...midColors, "#888800"])}
                            data-testid="button-add-midcolor"
                            className="flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg border border-dashed border-primary/40 text-xs text-primary/70 hover:border-primary hover:text-primary transition-colors"
                          >
                            <span className="text-base leading-none">+</span>
                            Add midtone {midColors.length < 2 ? "(up to 3)" : ""}
                          </button>
                        )}

                      </>
                    )}

                    {/* Strict colours — always visible */}
                    <div className="flex items-center justify-between pt-1 border-t border-border">
                      <div>
                        <p className="text-xs text-foreground">Strict colours</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {midColorStrict
                            ? useMidColor ? "Snaps to exact stops — no blending" : "Snaps to bg / text at 50% threshold"
                            : useMidColor ? "Smooth gradient between stops" : "Smooth blend between bg and text"}
                        </p>
                      </div>
                      <button
                        onClick={() => setMidColorStrict((v) => !v)}
                        data-testid="button-toggle-midcolor-strict"
                        className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ml-3 ${midColorStrict ? "bg-primary" : "bg-muted"}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${midColorStrict ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>
                </div>
                )}

                {renderMode !== "posterize" && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{renderMode === "ascii" ? "Font Size" : "Cell Size"}</Label>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={4}
                        max={renderMode === "ascii" ? 16 : 32}
                        step={1}
                        value={[fontSize]}
                        onValueChange={(v) => setFontSize(v[0])}
                        className="flex-1"
                        data-testid="slider-font-size"
                      />
                      <span className="text-xs font-mono w-8 text-right text-foreground">{fontSize}px</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Smaller = more detail, larger = chunkier</p>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Image Adjustments</Label>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground">Brightness</Label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-muted-foreground w-8 text-right">{brightness}%</span>
                        <button
                          onClick={() => setBrightness(100)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                          data-testid="button-reset-brightness"
                        >
                          reset
                        </button>
                      </div>
                    </div>
                    <Slider
                      min={0}
                      max={300}
                      step={5}
                      value={[brightness]}
                      onValueChange={(v) => setBrightness(v[0])}
                      data-testid="slider-brightness"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground">Contrast</Label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-muted-foreground w-8 text-right">{contrast}%</span>
                        <button
                          onClick={() => setContrast(100)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                          data-testid="button-reset-contrast"
                        >
                          reset
                        </button>
                      </div>
                    </div>
                    <Slider
                      min={0}
                      max={300}
                      step={5}
                      value={[contrast]}
                      onValueChange={(v) => setContrast(v[0])}
                      data-testid="slider-contrast"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground">Exposure</Label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-muted-foreground w-12 text-right">{exposure >= 0 ? "+" : ""}{exposure.toFixed(1)} EV</span>
                        <button
                          onClick={() => setExposure(0)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                          data-testid="button-reset-exposure"
                        >
                          reset
                        </button>
                      </div>
                    </div>
                    <Slider
                      min={-3}
                      max={3}
                      step={0.1}
                      value={[exposure]}
                      onValueChange={(v) => setExposure(v[0])}
                      data-testid="slider-exposure"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-foreground">Gamma</Label>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono text-muted-foreground w-8 text-right">{gamma.toFixed(1)}</span>
                        <button
                          onClick={() => setGamma(1)}
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                          data-testid="button-reset-gamma"
                        >
                          reset
                        </button>
                      </div>
                    </div>
                    <Slider
                      min={0.1}
                      max={4}
                      step={0.1}
                      value={[gamma]}
                      onValueChange={(v) => setGamma(v[0])}
                      data-testid="slider-gamma"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <Label className="text-xs text-foreground">Invert colours</Label>
                    <button
                      onClick={() => setInvert((v) => !v)}
                      data-testid="button-toggle-invert"
                      className={`relative w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0 ${invert ? "bg-primary" : "bg-muted"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${invert ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                  </div>
                </div>

                <div className="pt-1 border-t border-border">
                  <button
                    onClick={handleResetAllSettings}
                    data-testid="button-reset-all-settings"
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-0 py-1"
                  >
                    Reset all settings
                  </button>
                </div>

                {fileMode === "video" && videoDuration > 0 && (
                  <div className="flex flex-col gap-3">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Trim Video</Label>
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Start</span>
                        <span className="font-mono">{formatTime(startTime)}</span>
                      </div>
                      <Slider
                        min={0}
                        max={videoDuration}
                        step={0.01}
                        value={[startTime]}
                        onValueChange={handleStartTimeChange}
                        data-testid="slider-start-time"
                      />
                      <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
                        <span>End</span>
                        <span className="font-mono">{formatTime(endTime)}</span>
                      </div>
                      <Slider
                        min={0}
                        max={videoDuration}
                        step={0.01}
                        value={[endTime]}
                        onValueChange={handleEndTimeChange}
                        data-testid="slider-end-time"
                      />
                      <p className="text-xs text-muted-foreground">
                        Duration: {formatTime(endTime - startTime)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="bg-card border border-border rounded-xl p-4 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-foreground text-sm mb-2">How it works</p>
            <p>Upload any video or image file — processing happens entirely in your browser, nothing is uploaded to a server.</p>
            <p className="mt-1">Adjust the character set, colors, and font size to change the visual style. Use trim controls to loop a specific video segment.</p>
            <p className="mt-1"><span className="font-medium text-foreground">Export video</span> plays through the trimmed clip and captures it — the file downloads automatically when done.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
