"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { GlobeMapHandle, LngLat, MapStatus } from "@/components/globe-map";

type Google3DMapProps = {
  initialCoordinates: LngLat;
  initialZoom: number;
  onStatusChange: (status: MapStatus) => void;
  onMapClick: (coordinates: LngLat) => void;
};

type Coordinate = {
  lat: number;
  lng: number;
  altitude?: number;
};

type CoordinateLike = {
  lat?: unknown;
  lng?: unknown;
  altitude?: unknown;
};

type CameraOptions = {
  center: Coordinate;
  range: number;
  tilt: number;
  heading: number;
};

type Google3DElement = HTMLElement & {
  center: CoordinateLike;
  range: number;
  tilt: number;
  heading: number;
  flyCameraTo: (options: {
    endCamera: CameraOptions;
    durationMillis: number;
  }) => void;
};

type Google3DLibrary = {
  Map3DElement: new (options: {
    center: Coordinate;
    range: number;
    tilt: number;
    heading: number;
    mode: string;
    gestureHandling: string;
  }) => Google3DElement;
  Marker3DElement: new (options: {
    position: Coordinate;
    altitudeMode?: string;
    extruded?: boolean;
    label?: string;
  }) => HTMLElement;
  MapMode: { HYBRID: string };
  GestureHandling: { GREEDY: string };
};

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
      };
    };
  }
}

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAX_CAMERA_RANGE = 63_000_000;
let googleMapsApiPromise: Promise<void> | null = null;

function loadGoogleMapsApi(apiKey: string): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (googleMapsApiPromise) return googleMapsApiPromise;

  const pending = new Promise<void>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-the-world-google-maps="true"]',
    );
    const script = existingScript ?? document.createElement("script");

    const handleLoad = () => {
      if (window.google?.maps?.importLibrary) {
        resolve();
      } else {
        reject(new Error("Google Maps loaded without the importLibrary function."));
      }
    };
    const handleError = () => reject(new Error("The Google Maps JavaScript API script failed to load."));

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });

    if (!existingScript) {
      const url = new URL("https://maps.googleapis.com/maps/api/js");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("v", "weekly");
      url.searchParams.set("loading", "async");
      script.src = url.toString();
      script.async = true;
      script.defer = true;
      script.dataset.theWorldGoogleMaps = "true";
      document.head.appendChild(script);
    }
  });

  googleMapsApiPromise = pending.catch((error: unknown) => {
    googleMapsApiPromise = null;
    throw error;
  });
  return googleMapsApiPromise;
}

function rangeForZoom(zoom: number): number {
  if (zoom <= 2.2) return MAX_CAMERA_RANGE;
  const calculated = 32_000 * 2 ** ((9.8 - zoom) * 0.9);
  return Math.min(MAX_CAMERA_RANGE, Math.max(160, calculated));
}

function readNumber(value: unknown, fallback: number): number {
  try {
    const result =
      typeof value === "function"
        ? Number((value as () => unknown)())
        : Number(value);
    return Number.isFinite(result) ? result : fallback;
  } catch {
    return fallback;
  }
}

function readCenter(map: Google3DElement, fallback: LngLat): LngLat {
  const center = map.center as CoordinateLike | undefined;
  if (!center) return fallback;
  const latitude = readNumber(center.lat, fallback[1]);
  const longitude = readNumber(center.lng, fallback[0]);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return fallback;
  }
  return [longitude, latitude];
}

const Google3DMap = forwardRef<GlobeMapHandle, Google3DMapProps>(
  function Google3DMap(
    { initialCoordinates, initialZoom, onStatusChange, onMapClick },
    forwardedRef,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<Google3DElement | null>(null);
    const markerRef = useRef<HTMLElement | null>(null);
    const libraryRef = useRef<Google3DLibrary | null>(null);
    const targetRef = useRef<LngLat>(initialCoordinates);
    const zoomRef = useRef(initialZoom);
    const markerCoordinatesRef = useRef<LngLat | null>(null);
    const statusCallbackRef = useRef(onStatusChange);
    const clickCallbackRef = useRef(onMapClick);
    const resetCoordinatesRef = useRef(initialCoordinates);
    const resetZoomRef = useRef(initialZoom);

    statusCallbackRef.current = onStatusChange;
    clickCallbackRef.current = onMapClick;
    resetCoordinatesRef.current = initialCoordinates;
    resetZoomRef.current = initialZoom;

    function moveCamera(
      coordinates: LngLat,
      range: number,
      tilt: number,
      durationMillis = 900,
    ) {
      targetRef.current = coordinates;
      const map = mapRef.current;
      if (!map) return;

      const heading = readNumber(map.heading, 0);
      map.flyCameraTo({
        endCamera: {
          center: { lat: coordinates[1], lng: coordinates[0], altitude: 0 },
          range: Math.min(MAX_CAMERA_RANGE, Math.max(80, range)),
          tilt: Math.max(0, Math.min(67.5, tilt)),
          heading,
        },
        durationMillis,
      });
    }

    function renderMarker() {
      const map = mapRef.current;
      const library = libraryRef.current;
      const coordinates = markerCoordinatesRef.current;
      if (!map || !library || !coordinates) return;

      markerRef.current?.remove();
      const marker = new library.Marker3DElement({
        position: {
          lat: coordinates[1],
          lng: coordinates[0],
          altitude: 50,
        },
        altitudeMode: "RELATIVE_TO_GROUND",
        extruded: true,
        label: "Selected location",
      });
      map.append(marker);
      markerRef.current = marker;
    }

    useImperativeHandle(
      forwardedRef,
      () => ({
        flyTo(coordinates, zoom = 13) {
          zoomRef.current = zoom;
          moveCamera(
            coordinates,
            rangeForZoom(zoom),
            zoom <= 2.2 ? 0 : 62,
            1200,
          );
        },
        zoomIn() {
          const map = mapRef.current;
          if (!map) {
            zoomRef.current += 1;
            return;
          }
          const range = readNumber(map.range, rangeForZoom(zoomRef.current));
          zoomRef.current += 1;
          moveCamera(
            readCenter(map, targetRef.current),
            range / 1.7,
            readNumber(map.tilt, 62),
            250,
          );
        },
        zoomOut() {
          const map = mapRef.current;
          if (!map) {
            zoomRef.current -= 1;
            return;
          }
          const range = readNumber(map.range, rangeForZoom(zoomRef.current));
          zoomRef.current -= 1;
          moveCamera(
            readCenter(map, targetRef.current),
            Math.min(MAX_CAMERA_RANGE, range * 1.7),
            readNumber(map.tilt, 62),
            250,
          );
        },
        resetView() {
          const coordinates = resetCoordinatesRef.current;
          const zoom = resetZoomRef.current;
          targetRef.current = coordinates;
          zoomRef.current = zoom;
          moveCamera(
            coordinates,
            rangeForZoom(zoom),
            zoom <= 2.2 ? 0 : 62,
            1000,
          );
        },
        toggleProjection() {
          const map = mapRef.current;
          if (!map) return "globe";
          const currentTilt = readNumber(map.tilt, 62);
          const next = currentTilt > 25 ? "flat" : "globe";
          moveCamera(
            readCenter(map, targetRef.current),
            readNumber(map.range, rangeForZoom(zoomRef.current)),
            next === "flat" ? 0 : 62,
            500,
          );
          return next;
        },
        setMarker(coordinates) {
          markerCoordinatesRef.current = coordinates;
          renderMarker();
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      let failedToLoadTimer: ReturnType<typeof setTimeout> | undefined;
      let currentMap: Google3DElement | null = null;

      const markReady = () => {
        if (!cancelled) statusCallbackRef.current("ready");
      };
      const handleSteadyChange = (event: Event) => {
        const isSteady = (event as Event & { isSteady?: unknown }).isSteady;
        if (isSteady !== false) markReady();
      };
      const handleMapError = (event: Event) => {
        console.error("[THE WORLD] Google 3D map error:", event);
        if (!cancelled) statusCallbackRef.current("error");
      };
      const handleClick = (event: Event) => {
        const position = (event as Event & { position?: CoordinateLike }).position;
        if (!position) return;
        const latitude = readNumber(position.lat, Number.NaN);
        const longitude = readNumber(position.lng, Number.NaN);
        if (
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180
        ) {
          event.preventDefault();
          clickCallbackRef.current([longitude, latitude]);
        }
      };

      async function initializeMap() {
        statusCallbackRef.current("loading");
        if (!GOOGLE_MAPS_API_KEY) {
          statusCallbackRef.current("error");
          return;
        }

        try {
          await loadGoogleMapsApi(GOOGLE_MAPS_API_KEY);
          if (cancelled || !containerRef.current) return;

          const googleMaps = window.google?.maps;
          if (!googleMaps?.importLibrary) {
            throw new Error("Google Maps importLibrary is unavailable.");
          }

          const library = await googleMaps.importLibrary("maps3d") as Google3DLibrary;
          if (cancelled || !containerRef.current) return;

          libraryRef.current = library;
          const center = targetRef.current;
          const zoom = zoomRef.current;
          const map = new library.Map3DElement({
            center: { lat: center[1], lng: center[0], altitude: 0 },
            range: rangeForZoom(zoom),
            tilt: zoom <= 2.2 ? 0 : 62,
            heading: 0,
            mode: library.MapMode.HYBRID,
            gestureHandling: library.GestureHandling.GREEDY,
          });

          map.style.display = "block";
          map.style.width = "100%";
          map.style.height = "100%";
          map.style.minHeight = "100%";
          map.setAttribute("aria-label", "Google photorealistic 3D map");
          map.addEventListener("gmp-steadychange", handleSteadyChange);
          map.addEventListener("gmp-error", handleMapError);
          map.addEventListener("gmp-click", handleClick);

          currentMap = map;
          mapRef.current = map;
          containerRef.current.replaceChildren(map);
          renderMarker();

          failedToLoadTimer = setTimeout(() => {
            if (!cancelled) statusCallbackRef.current("error");
          }, 30000);
        } catch (error) {
          if (!cancelled) {
            console.error("[THE WORLD] Could not initialize Google 3D:", error);
            statusCallbackRef.current("error");
          }
        }
      }

      void initializeMap();

      return () => {
        cancelled = true;
        if (failedToLoadTimer) clearTimeout(failedToLoadTimer);
        if (currentMap) {
          currentMap.removeEventListener("gmp-steadychange", handleSteadyChange);
          currentMap.removeEventListener("gmp-error", handleMapError);
          currentMap.removeEventListener("gmp-click", handleClick);
        }
        markerRef.current?.remove();
        markerRef.current = null;
        currentMap?.remove();
        mapRef.current = null;
        libraryRef.current = null;
      };
    }, []);

    return (
      <div
        ref={containerRef}
        className="globe-map-canvas google-3d-map-canvas"
        aria-label="Google photorealistic 3D map"
      />
    );
  },
);

export default Google3DMap;
