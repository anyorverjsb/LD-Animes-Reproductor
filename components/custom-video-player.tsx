"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Play, Pause, Volume2, VolumeX, Maximize, RotateCcw, Rewind, FastForward, Maximize2, Minimize2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import Hls from "hls.js"

interface CustomVideoPlayerProps {
  src: string
  title?: string
  onError?: () => void
  onLoad?: () => void
  forceFullSize?: boolean
  subtitleUrl?: string
}

export function CustomVideoPlayer({ src, title, onError, onLoad, forceFullSize = false, subtitleUrl }: CustomVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSeeking, setIsSeeking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isInIframe, setIsInIframe] = useState(false)
  const [showSettingsMenu, setShowSettingsMenu] = useState(false)
  const [showSkipIcon, setShowSkipIcon] = useState<"forward" | "backward" | null>(null)
  const [buffered, setBuffered] = useState(0)
  const [isFillScreen, setIsFillScreen] = useState(false)
  const [autoDetectedSubtitleUrl, setAutoDetectedSubtitleUrl] = useState<string | null>(null)

  const controlsTimeoutRef = useRef<NodeJS.Timeout>()
  const lastTapRef = useRef<number>(0)
  const tapTimeoutRef = useRef<NodeJS.Timeout>()
  const skipIconTimeoutRef = useRef<NodeJS.Timeout>()
  const progressSaveTimeoutRef = useRef<NodeJS.Timeout>()
  const lastSavedTimeRef = useRef<number>(0)

  const getVideoKey = () => {
    const videoIdentifier = `${title || "untitled"}_${src.split("/").pop() || src}`

    const hash = btoa(videoIdentifier)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 60) // Aumentado a 60 caracteres para mayor especificidad

    const finalKey = `video_progress_${hash}`
    return finalKey
  }

  const detectSubtitleUrl = async (videoUrl: string): Promise<string | null> => {
    // Si ya hay una URL de subtítulo proporcionada, usarla
    if (subtitleUrl) {
      return subtitleUrl
    }

    // Intentar detectar automáticamente el archivo de subtítulos
    const subtitleExtensions = [".srt", ".vtt", ".ass", ".ssa"]
    
    // Obtener el nombre del archivo sin extensión
    const lastSlash = videoUrl.lastIndexOf("/")
    const fileName = videoUrl.substring(lastSlash + 1)
    const fileNameWithoutExt = fileName.replace(/\.[^.]+(\?.*)?$/, "")
    
    // Obtener el directorio base del video
    const basePath = videoUrl.substring(0, lastSlash)

    // Intentar cada extensión de subtítulos
    for (const ext of subtitleExtensions) {
      const subtitleUrl = `${basePath}/${fileNameWithoutExt}${ext}`
      
      try {
        // Usar GET con un timeout pequeño para verificar si el archivo existe
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 5000) // 5 segundos de timeout
        
        const response = await fetch(subtitleUrl, { 
          method: "GET",
          mode: "cors",
          signal: controller.signal,
          headers: {
            "Range": "bytes=0-1" // Solo obtener los primeros bytes para no descargar el archivo entero
          }
        })
        
        clearTimeout(timeout)
        
        // Si la respuesta es OK o si es un rango parcial, el archivo existe
        if (response.ok || response.status === 206) {
          console.log(`[v0] Subtítulos detectados automáticamente: ${subtitleUrl}`)
          return subtitleUrl
        }
      } catch (error) {
        // Intentar con siguiente extensión
        console.log(`[v0] No se encontró ${ext} para este video`)
      }
    }

    return null
  }

  const saveProgress = (time: number) => {
    if (time > 10 && duration > 0 && time < duration - 10) {
      const videoKey = getVideoKey()
      const progressData = {
        currentTime: time,
        duration: duration,
        timestamp: Date.now(),
        title: title || "",
        src: src,
        uniqueId: btoa(`${title}_${src}`)
          .replace(/[^a-zA-Z0-9]/g, "")
          .substring(0, 20),
      }
      localStorage.setItem(videoKey, JSON.stringify(progressData))
    }
  }

  const loadSavedProgress = () => {
    const videoKey = getVideoKey()
    const savedData = localStorage.getItem(videoKey)
    const currentUniqueId = btoa(`${title}_${src}`)
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 20)

    if (!savedData) {
      return 0
    }

    try {
      const progressData = JSON.parse(savedData)
      const daysSinceLastView = (Date.now() - progressData.timestamp) / (1000 * 60 * 60 * 24)

      if (
        daysSinceLastView < 30 &&
        progressData.currentTime &&
        typeof progressData.currentTime === "number" &&
        !isNaN(progressData.currentTime) &&
        progressData.currentTime > 10 &&
        progressData.duration &&
        progressData.currentTime < progressData.duration - 10 &&
        progressData.title === title && // Verificación del título
        progressData.uniqueId === currentUniqueId // Verificación adicional del uniqueId
      ) {
        return progressData.currentTime
      } else {
        localStorage.removeItem(videoKey)
        return 0
      }
    } catch (error) {
      console.error("[v0] Error loading saved progress:", error)
      localStorage.removeItem(videoKey)
      return 0
    }
  }

  const clearProgress = () => {
    const videoKey = getVideoKey()
    localStorage.removeItem(videoKey)
  }

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        window.innerWidth <= 768 ||
          /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
      )
    }

    const checkIframe = () => {
      setIsInIframe(window.self !== window.top)
    }

    checkMobile()
    checkIframe()
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  // Detectar automáticamente subtítulos cuando cambia la URL del video
  useEffect(() => {
    const detectAndSetSubtitles = async () => {
      const detectedUrl = await detectSubtitleUrl(src)
      setAutoDetectedSubtitleUrl(detectedUrl)
    }

    if (src) {
      detectAndSetSubtitles()
    }
  }, [src, subtitleUrl])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") {
        return
      }

      const video = videoRef.current
      if (!video) return

      const activeElement = document.activeElement
      const isVideoFocused =
        activeElement === video || activeElement === containerRef.current || activeElement === document.body

      switch (e.key.toLowerCase()) {
        case "f":
          e.preventDefault()
          toggleFullscreen()
          break
        case " ":
        case "spacebar":
          e.preventDefault()
          e.stopPropagation()
          togglePlay()
          break
        case "escape":
          if (isFullscreen) {
            e.preventDefault()
            document.exitFullscreen()
          }
          break
        case "arrowup":
          e.preventDefault()
          const newVolumeUp = Math.min(volume + 0.1, 1)
          video.volume = newVolumeUp
          setVolume(newVolumeUp)
          setIsMuted(false)
          showControlsTemporarily()
          break
        case "arrowdown":
          e.preventDefault()
          const newVolumeDown = Math.max(volume - 0.1, 0)
          video.volume = newVolumeDown
          setVolume(newVolumeDown)
          setIsMuted(newVolumeDown === 0)
          showControlsTemporarily()
          break
        case "arrowleft":
          e.preventDefault()
          video.currentTime = Math.max(video.currentTime - 10, 0)
          showSkipIconTemporarily("backward")
          showControlsTemporarily()
          break
        case "arrowright":
          e.preventDefault()
          video.currentTime = Math.min(video.currentTime + 10, video.duration)
          showSkipIconTemporarily("forward")
          showControlsTemporarily()
          break
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    containerRef.current?.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      containerRef.current?.removeEventListener("keydown", handleKeyDown)
    }
  }, [volume, isFullscreen])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedData = () => {
      setIsLoading(false)
      setError(null)
      onLoad?.()
      setShowControls(true)

      const savedTime = loadSavedProgress()

      if (
        savedTime > 0 &&
        video.duration > 0 &&
        savedTime < video.duration - 10 &&
        savedTime > 10 // Reducido de 30 a 10 segundos
      ) {
        video.currentTime = savedTime
        setCurrentTime(savedTime)
      } else {
        video.currentTime = 0
        setCurrentTime(0)
      }

      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false)
      }, 10000)
    }

    const handleError = () => {
      setIsLoading(false)
      setError("Error al cargar el video")
      onError?.()
    }

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
    }

    const handleDurationChange = () => {
      setDuration(video.duration)
    }

    const handleLoadStart = () => {
      setIsLoading(true)
    }

    const handleSeeking = () => {
      setIsSeeking(true)
    }

    const handleSeeked = () => {
      setIsSeeking(false)
    }

    const handleWaiting = () => {
      setIsSeeking(true)
    }

    const handleCanPlay = () => {
      setIsSeeking(false)
    }

    const handleEnded = () => {
      // Video terminado, mantener el progreso para potencial reanudación
    }

    const handleProgress = () => {
      if (video.buffered.length > 0 && video.duration > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        const bufferedPercent = (bufferedEnd / video.duration) * 100
        setBuffered(bufferedPercent)
      }
    }

    video.addEventListener("loadeddata", handleLoadedData)
    video.addEventListener("error", handleError)
    video.addEventListener("timeupdate", handleTimeUpdate)
    video.addEventListener("durationchange", handleDurationChange)
    video.addEventListener("loadstart", handleLoadStart)
    video.addEventListener("seeking", handleSeeking)
    video.addEventListener("seeked", handleSeeked)
    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("canplay", handleCanPlay)
    video.addEventListener("ended", handleEnded)
    video.addEventListener("progress", handleProgress)

    video.preload = "metadata"
    video.crossOrigin = "anonymous"

    let hlsInstance: Hls | null = null

    if (src.endsWith(".m3u8")) {
      // Soporte para HLS (HTTP Live Streaming)
      if (Hls.isSupported()) {
        hlsInstance = new Hls()
        hlsInstance.loadSource(src)
        hlsInstance.attachMedia(video)
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Fallback para navegadores que soportan HLS nativamente (Safari)
        video.src = src
      }
    } else if (src.endsWith(".mkv")) {
      const source = document.createElement("source")
      source.src = src
      source.type = 'video/x-matroska; codecs="avc1.42E01E, mp4a.40.2"'

      video.innerHTML = ""
      video.appendChild(source)

      video.setAttribute("type", "video/x-matroska")

      const fallbackSource1 = document.createElement("source")
      fallbackSource1.src = src
      fallbackSource1.type = "video/webm"
      video.appendChild(fallbackSource1)

      const fallbackSource2 = document.createElement("source")
      fallbackSource2.src = src
      fallbackSource2.type = "video/mp4"
      video.appendChild(fallbackSource2)
    }

    return () => {
      video.removeEventListener("loadeddata", handleLoadedData)
      video.removeEventListener("error", handleError)
      video.removeEventListener("timeupdate", handleTimeUpdate)
      video.removeEventListener("durationchange", handleDurationChange)
      video.removeEventListener("loadstart", handleLoadStart)
      video.removeEventListener("seeking", handleSeeking)
      video.removeEventListener("seeked", handleSeeked)
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("canplay", handleCanPlay)
      video.removeEventListener("ended", handleEnded)
      video.removeEventListener("progress", handleProgress)
      if (hlsInstance) {
        hlsInstance.destroy()
      }
    }
  }, [src, onLoad, onError])

  // Intervalo para guardar progreso automáticamente cada segundo mientras se reproduce
  useEffect(() => {
    if (!isPlaying || !videoRef.current) return

    const interval = setInterval(() => {
      const video = videoRef.current
      if (!video) return

      const time = video.currentTime
      const dur = video.duration

      // Guardar el progreso si cumple las condiciones
      if (time > 10 && dur > 0 && time < dur - 10) {
        const videoKey = getVideoKey()
        const progressData = {
          currentTime: time,
          duration: dur,
          timestamp: Date.now(),
          title: title || "",
          src: src,
          uniqueId: btoa(`${title}_${src}`)
            .replace(/[^a-zA-Z0-9]/g, "")
            .substring(0, 20),
        }
        localStorage.setItem(videoKey, JSON.stringify(progressData))
      }
    }, 1000) // Guardar cada 1 segundo

    return () => clearInterval(interval)
  }, [isPlaying, src, title])

  useEffect(() => {
    const handleBeforeUnload = () => {
      const video = videoRef.current
      if (video) {
        saveProgress(video.currentTime)
      }
    }

    const handleVisibilityChange = () => {
      const video = videoRef.current
      if (document.hidden && video) {
        saveProgress(video.currentTime)
      }
    }

    const handlePause = () => {
      const video = videoRef.current
      if (video) {
        saveProgress(video.currentTime)
      }
    }

    const video = videoRef.current
    if (video) {
      video.addEventListener("pause", handlePause)
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      if (video) {
        video.removeEventListener("pause", handlePause)
      }
      window.removeEventListener("beforeunload", handleBeforeUnload)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFS = !!(document.fullscreenElement || 
                     (document as any).webkitFullscreenElement || 
                     (document as any).mozFullScreenElement || 
                     (document as any).msFullscreenElement)
      setIsFullscreen(isFS)
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
    document.addEventListener("mozfullscreenchange", handleFullscreenChange)
    document.addEventListener("MSFullscreenChange", handleFullscreenChange)
    
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange)
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange)
    }
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
    } else {
      video.play()
    }
    setIsPlaying(!isPlaying)
  }

  const handleSeek = (value: number[]) => {
    const video = videoRef.current
    if (!video) return

    const newTime = (value[0] / 100) * duration
    video.currentTime = newTime
    setCurrentTime(newTime)

    saveProgress(newTime)
  }

  const handleVolumeChange = (value: number[]) => {
    const video = videoRef.current
    if (!video) return

    const newVolume = value[0] / 100
    video.volume = newVolume
    setVolume(newVolume)
    setIsMuted(newVolume === 0)
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return

    if (isMuted) {
      video.volume = volume
      setIsMuted(false)
    } else {
      video.volume = 0
      setIsMuted(true)
    }
  }

  const toggleFullscreen = () => {
    const container = containerRef.current
    if (!container) return

    if (document.fullscreenElement) {
      document.exitFullscreen()
      // Restaurar orientación cuando salimos de fullscreen
      if (screen.orientation && screen.orientation.unlock) {
        screen.orientation.unlock()
      }
    } else {
      container.requestFullscreen()
      // Rotar a horizontal cuando entramos a fullscreen en móviles
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {
          // Si falla el lock de orientación, continuar sin error
        })
      }
    }
  }

  const toggleFillScreen = () => {
    const video = videoRef.current
    if (!video) return

    setIsFillScreen(!isFillScreen)
    video.classList.toggle('fill-screen')
    
    // También activar fullscreen si no está ya en ese modo
    if (!document.fullscreenElement) {
      const container = containerRef.current
      if (container) {
        container.requestFullscreen().catch(() => {
          // Si falla fullscreen, continuar sin error
        })
      }
    }
  }

  const changePlaybackRate = (rate: number) => {
    const video = videoRef.current
    if (!video) return

    video.playbackRate = rate
    setPlaybackRate(rate)
    setShowSettingsMenu(false)
  }

  const skipBackward = () => {
    const video = videoRef.current
    if (!video) return
    const newTime = Math.max(video.currentTime - 10, 0)
    video.currentTime = newTime
    showSkipIconTemporarily("backward")
    showControlsTemporarily()

    saveProgress(newTime)
  }

  const skipForward = () => {
    const video = videoRef.current
    if (!video) return
    const newTime = Math.min(video.currentTime + 10, video.duration)
    video.currentTime = newTime
    showSkipIconTemporarily("forward")
    showControlsTemporarily()

    saveProgress(newTime)
  }

  const formatTime = (time: number) => {
    const hours = Math.floor(time / 3600)
    const minutes = Math.floor((time % 3600) / 60)
    const seconds = Math.floor(time % 60)
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`
  }

  const showControlsTemporarily = () => {
    setShowControls(true)
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current)
    }
    controlsTimeoutRef.current = setTimeout(() => {
      setShowControls(false)
    }, 10000)
  }

  const retry = () => {
    const video = videoRef.current
    if (!video) return

    setError(null)
    setIsLoading(true)
    video.load()
  }

  const getFormattedTitle = () => {
    if (!title) return ""

    // Si el título contiene "LD Animes - Reproductor", devolverlo tal como está
    if (title.includes("LD Animes - Reproductor")) {
      return title
    }

    const filename = title.split("/").pop() || title
    return filename.replace(/\s*-?\s*LD\s*Animes?\s*/gi, "").trim()
  }

  const handleVideoClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if ((e.target as HTMLElement).closest(".controls-area")) {
      return
    }

    if (showControls) {
      setShowControls(false)
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    } else {
      showControlsTemporarily()
    }
  }

  const handleButtonClick = (callback: () => void) => {
    return (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      callback()
      const target = e.target as HTMLElement
      const button = target.closest("button")
      if (button) {
        button.blur()
      }
    }
  }

  const skipOpEd = () => {
    const video = videoRef.current
    if (!video) return

    const skipTime = 85
    const newTime = Math.min(video.currentTime + skipTime, video.duration)
    video.currentTime = newTime

    saveProgress(newTime)
  }

  const showSkipIconTemporarily = (direction: "forward" | "backward") => {
    setShowSkipIcon(direction)
    if (skipIconTimeoutRef.current) {
      clearTimeout(skipIconTimeoutRef.current)
    }
    skipIconTimeoutRef.current = setTimeout(() => {
      setShowSkipIcon(null)
    }, 1000)
  }

  const SpeedMenu = ({ isFullscreenMode = false }: { isFullscreenMode?: boolean }) => (
    <DropdownMenu modal={false} open={showSettingsMenu} onOpenChange={setShowSettingsMenu}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={!showControls || isLoading}
          className="text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent active:bg-transparent disabled:pointer-events-none disabled:opacity-50 p-2"
        >
          {/* Placeholder for Settings icon */}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="bg-gray-900/95 border-gray-700 backdrop-blur-md shadow-xl rounded-lg"
        style={{
          zIndex: isFullscreenMode ? 2147483647 : 999999,
          position: "fixed",
          minWidth: "120px",
          maxWidth: "150px",
        }}
        side="top"
        align="end"
        sideOffset={8}
        alignOffset={-4}
        forceMount={isFullscreenMode}
        container={isFullscreenMode ? containerRef.current : undefined}
      >
        <div className="px-3 py-2 text-xs text-gray-400 font-medium border-b border-gray-700">
          Velocidad de reproducción
        </div>
        {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
          <DropdownMenuItem
            key={rate}
            onClick={() => changePlaybackRate(rate)}
            className={`text-white hover:bg-white/10 cursor-pointer transition-colors flex items-center justify-between px-3 py-2 ${
              playbackRate === rate ? "bg-blue-600/20 text-blue-400" : ""
            }`}
          >
            <span className="text-sm font-medium">{rate}x</span>
            {playbackRate === rate && <span className="text-blue-400 text-sm">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (error) {
    return (
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden flex items-center justify-center">
        <div className="text-center text-white p-6">
          <div className="mb-4">
            <RotateCcw className="h-12 w-12 mx-auto mb-2 text-red-400" />
            <p className="text-lg font-semibold">Error al cargar el video</p>
            <p className="text-sm text-gray-300 mt-1">No se pudo reproducir el contenido</p>
          </div>
          <Button
            onClick={retry}
            variant="outline"
            className="text-white border-white hover:bg-white hover:text-black bg-transparent"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`relative bg-black overflow-hidden group ${
        isFullscreen ? "fixed inset-0 z-50" : forceFullSize ? "w-full h-full" : "aspect-video rounded-lg"
      }`}
      style={
        isFullscreen && isMobile
          ? {
              transform: "rotate(90deg)",
              transformOrigin: "center center",
              width: "100vh",
              height: "100vw",
              position: "fixed",
              top: "50%",
              left: "50%",
              marginTop: "-50vw",
              marginLeft: "-50vh",
            }
          : {}
      }
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full cursor-pointer transition-all duration-200"
        style={{ objectFit: isFillScreen ? 'fill' : 'contain' }}
        onClick={handleVideoClick}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        autoPlay={false}
        preload="metadata"
        crossOrigin="anonymous"
        playsInline
        controls={false}
      >
        {(autoDetectedSubtitleUrl || subtitleUrl) && (
          <track
            kind="subtitles"
            src={autoDetectedSubtitleUrl || subtitleUrl}
            srcLang="es"
            label="Español"
            default
          />
        )}
      </video>

      {showControls && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex items-center justify-center gap-8">
            <button
              id="skipBackBtn"
              onClick={handleButtonClick(skipBackward)}
              className="side-skip-btn bg-blue-600 hover:bg-blue-700 rounded-full p-4 cursor-pointer pointer-events-auto transition-all duration-200 hover:scale-110 flex items-center justify-center"
              aria-label="Skip backward"
            >
              <Rewind className="h-6 w-6 text-white" fill="white" />
            </button>
            <button
              onClick={handleButtonClick(togglePlay)}
              className={`bg-blue-600 hover:bg-blue-700 rounded-full p-4 cursor-pointer hover:scale-110 flex items-center justify-center ${
                isLoading || isSeeking
                  ? "opacity-0 pointer-events-none"
                  : "pointer-events-auto transition-all duration-200"
              }`}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-8 w-8 text-white" />
              ) : (
                <Play className="h-8 w-8 text-white ml-1" />
              )}
            </button>
            <button
              id="skipForwardBtn"
              onClick={handleButtonClick(skipForward)}
              className="side-skip-btn bg-blue-600 hover:bg-blue-700 rounded-full p-4 cursor-pointer pointer-events-auto transition-all duration-200 hover:scale-110 flex items-center justify-center"
              aria-label="Skip forward"
            >
              <FastForward className="h-6 w-6 text-white" fill="white" />
            </button>
          </div>
        </div>
      )}

      {showSkipIcon && (
        <div className="absolute inset-0 flex items-center pointer-events-none">
          {showSkipIcon === "backward" ? (
            <div className="flex items-center justify-start pl-8 w-full">
              <div className="bg-black/70 backdrop-blur-sm rounded-full p-4 flex items-center space-x-2 animate-in fade-in-0 zoom-in-95 duration-300">
                <Rewind className="h-6 w-6 text-white" fill="white" />
                <span className="text-white font-semibold text-sm">10s</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end pr-8 w-full">
              <div className="bg-black/70 backdrop-blur-sm rounded-full p-4 flex items-center space-x-2 animate-in fade-in-0 zoom-in-95 duration-300">
                <span className="text-white font-semibold text-sm">10s</span>
                <FastForward className="h-6 w-6 text-white" fill="white" />
              </div>
            </div>
          )}
        </div>
      )}

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-center text-white">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p>Cargando video...</p>
          </div>
        </div>
      )}

      {isSeeking && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-white border-t-transparent"></div>
        </div>
      )}

      <div
        className={`absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 transition-opacity duration-300 ${
          showControls && !isLoading ? "opacity-100 pointer-events-none" : "opacity-0 pointer-events-none"
        }`}
      >
        {getFormattedTitle() && (
          <div className="absolute top-4 left-4 right-4 pointer-events-none">
            <h3 className="text-white text-lg font-semibold truncate">{getFormattedTitle()}</h3>
          </div>
        )}

        <div
          className={`absolute bottom-0 left-0 right-0 p-3 controls-area ${
            showControls && !isLoading ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          {(!isInIframe || isFullscreen || forceFullSize) && (
            <div className="mb-3">
              <div className="relative w-full h-2 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-white/40 transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${buffered}%` }}
                />
                <div
                  className="absolute top-0 left-0 h-full bg-blue-600 transition-all duration-150 ease-out rounded-full"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                />
                <Slider
                  value={[duration ? (currentTime / duration) * 100 : 0]}
                  onValueChange={handleSeek}
                  max={100}
                  step={0.1}
                  className="absolute inset-0 w-full opacity-0 cursor-pointer [&_[role=slider]]:opacity-0"
                  disabled={!showControls || isLoading}
                />
              </div>
              <div className="flex justify-between text-xs text-white mt-1 px-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          <div className={`flex items-center ${isMobile ? "justify-between" : "justify-between"}`}>
            <div className={`flex items-center ${isMobile ? "space-x-2" : "space-x-3"}`}>
              <Button
                variant="ghost"
                size={isMobile ? "sm" : "default"}
                onClick={handleButtonClick(togglePlay)}
                disabled={!showControls || isLoading}
                className="text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent active:bg-transparent active:text-white disabled:pointer-events-none disabled:opacity-50 p-2"
              >
                {isPlaying ? (
                  <Pause className={`${isMobile ? "h-5 w-5" : "h-6 w-6"}`} />
                ) : (
                  <Play className={`${isMobile ? "h-5 w-5" : "h-6 w-6"}`} />
                )}
              </Button>

              <span className="text-white text-sm font-medium">{formatTime(currentTime)}</span>

              {(!isInIframe || isFullscreen || forceFullSize) && (
                <div className={`flex items-center ${isMobile ? "space-x-1" : "space-x-2"}`}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleButtonClick(toggleMute)}
                disabled={!showControls || isLoading}
                className="text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent disabled:pointer-events-none disabled:opacity-50 p-2 h-auto"
              >
                    {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </Button>
                  <div className="w-20">
                    <Slider
                      value={[isMuted ? 0 : volume * 100]}
                      onValueChange={handleVolumeChange}
                      max={100}
                      step={1}
                      disabled={!showControls || isLoading}
                      className="[&_[role=slider]]:bg-blue-600 [&_[role=slider]]:border-blue-600 [&_.bg-primary]:bg-blue-600"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className={`flex items-center ${isMobile ? "space-x-1" : "space-x-2"}`}>
              {(!isInIframe || isFullscreen) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleButtonClick(skipOpEd)}
                  disabled={!showControls || isLoading}
                  className="text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent disabled:pointer-events-none disabled:opacity-50 p-2 text-xs"
                >
                  Saltar OP/ED
                </Button>
              )}

              {(!isInIframe || isFullscreen) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleButtonClick(toggleFillScreen)}
                  disabled={!showControls || isLoading}
                  className={`text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent disabled:pointer-events-none disabled:opacity-50 p-2 transition-colors duration-200 ${
                    isFillScreen ? "bg-blue-600/40" : ""
                  }`}
                  title={isFillScreen ? "Desactivar pantalla completa con relleno" : "Activar pantalla completa con relleno"}
                >
                  {isFillScreen ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </Button>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={handleButtonClick(toggleFullscreen)}
                disabled={!showControls || isLoading}
                className="text-white hover:text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-0 focus:bg-transparent disabled:pointer-events-none disabled:opacity-50 p-2"
              >
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
