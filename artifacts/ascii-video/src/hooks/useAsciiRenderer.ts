import { useRef, useCallback, useEffect } from "react";
import { frameToAscii, frameToHalftone, frameToBitmap, frameToPosterize, frameToTiles, AsciiOptions } from "@/lib/ascii";

interface UseAsciiRendererProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  outputCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  options: AsciiOptions;
  isPlaying: boolean;
}

export function useAsciiRenderer({
  videoRef,
  outputCanvasRef,
  options,
  isPlaying,
}: UseAsciiRendererProps) {
  const scratchCanvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const animFrameRef = useRef<number | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  function renderFrame(
    source: HTMLVideoElement | HTMLImageElement,
    outputCanvas: HTMLCanvasElement,
    scratchCanvas: HTMLCanvasElement,
    opts: AsciiOptions
  ) {
    if (opts.renderMode === "halftone") {
      frameToHalftone(source, scratchCanvas, outputCanvas, opts);
    } else if (opts.renderMode === "bitmap") {
      frameToBitmap(source, scratchCanvas, outputCanvas, opts);
    } else if (opts.renderMode === "posterize") {
      frameToPosterize(source, scratchCanvas, outputCanvas, opts);
    } else if (opts.renderMode === "tiles") {
      frameToTiles(source, scratchCanvas, outputCanvas, opts);
    } else {
      frameToAscii(source, scratchCanvas, outputCanvas, opts);
    }
  }

  const render = useCallback(() => {
    const video = videoRef.current;
    const outputCanvas = outputCanvasRef.current;
    const scratchCanvas = scratchCanvasRef.current;

    if (!video || !outputCanvas || video.paused || video.ended) {
      animFrameRef.current = null;
      return;
    }

    renderFrame(video, outputCanvas, scratchCanvas, optionsRef.current);
    animFrameRef.current = requestAnimationFrame(render);
  }, [videoRef, outputCanvasRef]);

  const renderSingleFrame = useCallback((source?: HTMLVideoElement | HTMLImageElement) => {
    const video = videoRef.current;
    const outputCanvas = outputCanvasRef.current;
    const scratchCanvas = scratchCanvasRef.current;
    const src = source ?? video;
    if (!src || !outputCanvas) return;
    renderFrame(src, outputCanvas, scratchCanvas, optionsRef.current);
  }, [videoRef, outputCanvasRef]);

  useEffect(() => {
    if (isPlaying) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(render);
    } else {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      renderSingleFrame();
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isPlaying, render, renderSingleFrame]);

  return { renderSingleFrame };
}
