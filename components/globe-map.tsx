"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

export type MapStatus = "loading" | "ready" | "error";
export type LngLat = [longitude: number, latitude: number];

export type GlobeMapHandle = {
  flyTo: (coordinates: LngLat, zoom?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  toggleProjection: () => "globe" | "flat";
  setMarker: (coordinates: LngLat) => void;
};

type GlobeMapProps = {
  onStatusChange: (status: MapStatus) => void;
  onMapClick: (coordinates: LngLat) => void;
};

const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
  "https://tiles.openfreemap.org/styles/liberty";

const GlobeMap = forwardRef<GlobeMapHandle, GlobeMapProps>(
  function GlobeMap({ onStatusChange, onMapClick }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<MapLibreMap | null>(null);
    const markerRef = useRef<MapLibreMarker | null>(null);
    const libraryRef = useRef<typeof import("maplibre-gl") | null>(null);
    const projectionRef = useRef<"globe" | "mercator">("globe");
    const statusCallbackRef = useRef(onStatusChange);
    const mapClickCallbackRef = useRef(onMapClick);

    statusCallbackRef.current = onStatusChange;
    mapClickCallbackRef.current = onMapClick;

    useImperativeHandle(
      ref,
      () => ({
        flyTo(coordinates, zoom = 13) {
          mapRef.current?.flyTo({
            center: coordinates,
            zoom,
            speed: 0.82,
            curve: 1.35,
            essential: true,
          });
        },
        zoomIn() {
          mapRef.current?.zoomIn({ duration: 250 });
        },
        zoomOut() {
          mapRef.current?.zoomOut({ duration: 250 });
        },
        resetView() {
          projectionRef.current = "globe";
          mapRef.current?.setProjection({ type: "globe" });
          mapRef.current?.flyTo({
            center: [12, 8],
            zoom: 1.65,
            pitch: 0,
            bearing: 0,
            duration: 1000,
            essential: true,
          });
        },
        toggleProjection() {
          const next = projectionRef.current === "globe" ? "mercator" : "globe";
          projectionRef.current = next;
          mapRef.current?.setProjection({
            type: next === "globe" ? "globe" : "mercator",
          });
          return next === "globe" ? "globe" : "flat";
        },
        setMarker(coordinates) {
          const map = mapRef.current;
          const library = libraryRef.current;
          if (!map || !library) return;

          markerRef.current?.remove();
          const element = document.createElement("div");
          element.className = "world-map-marker";
          element.setAttribute("aria-label", "Selected location");

          markerRef.current = new library.Marker({
            element,
            anchor: "bottom",
          })
            .setLngLat(coordinates)
            .addTo(map);
        },
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      let styleReady = false;
      let failedToLoadTimer: ReturnType<typeof setTimeout> | undefined;
      let map: MapLibreMap | null = null;

      function markStyleReady() {
        if (cancelled || styleReady) return;
        styleReady = true;
        if (failedToLoadTimer) clearTimeout(failedToLoadTimer);
        statusCallbackRef.current("ready");
      }

      async function initializeMap() {
        try {
          const library = await import("maplibre-gl");
          if (cancelled || !containerRef.current) return;

          libraryRef.current = library;

          map = new library.Map({
            container: containerRef.current,
            style: MAP_STYLE,
            center: [12, 8],
            zoom: 1.65,
            minZoom: 1.2,
            maxZoom: 19,
            pitch: 0,
            bearing: 0,
            attributionControl: false,
            renderWorldCopies: false,
          });

          mapRef.current = map;
          map.addControl(
            new library.AttributionControl({
              compact: true,
              customAttribution: "OpenFreeMap",
            }),
            "bottom-left",
          );

          map.on("style.load", () => {
            if (cancelled) return;
            map?.setProjection({ type: projectionRef.current });
            // The map style can be ready and already rendering even while a
            // slow or failed tile request prevents MapLibre's full "load" event.
            markStyleReady();
          });

          map.on("click", (event) => {
            mapClickCallbackRef.current([event.lngLat.lng, event.lngLat.lat]);
          });

          map.on("load", markStyleReady);

          map.on("error", (event) => {
            // Keep a useful clue in the browser console instead of silently
            // treating every tile/resource failure as a total map failure.
            if (!styleReady) {
              console.warn("[THE WORLD] Map resource error:", event.error);
            }
          });

          failedToLoadTimer = setTimeout(() => {
            if (cancelled || styleReady) return;

            if (map?.isStyleLoaded()) {
              markStyleReady();
              return;
            }

            statusCallbackRef.current("error");
          }, 30000);
        } catch (error) {
          if (!cancelled) {
            console.error("[THE WORLD] Could not initialize the map:", error);
            statusCallbackRef.current("error");
          }
        }
      }

      statusCallbackRef.current("loading");
      void initializeMap();

      return () => {
        cancelled = true;
        if (failedToLoadTimer) clearTimeout(failedToLoadTimer);
        markerRef.current?.remove();
        markerRef.current = null;
        map?.remove();
        mapRef.current = null;
        libraryRef.current = null;
      };
    }, []);

    return (
      <div
        ref={containerRef}
        className="globe-map-canvas"
        aria-label="Interactive map of the world"
      />
    );
  },
);

export default GlobeMap;
