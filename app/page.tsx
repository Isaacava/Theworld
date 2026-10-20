"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  Building2,
  Check,
  ChevronRight,
  Compass,
  Globe,
  Layers,
  LocateFixed,
  MapPin,
  Menu,
  MessageCircle,
  Minus,
  Navigation,
  Plus,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import GlobeMap, {
  type GlobeMapHandle,
  type LngLat,
  type MapStatus,
} from "@/components/globe-map";
import {
  getPlaceKind,
  getPlaceSubtitle,
  getPlaceTitle,
  getPlaceZoom,
  searchPlaces,
  type PlaceSearchResult,
} from "@/lib/places";

type SelectedPlace = {
  id: string;
  name: string;
  subtitle: string;
  displayName: string;
  kind: string;
  coordinates: LngLat;
  zoom: number;
};

const QUICK_PLACES = [
  {
    name: "Lagos",
    subtitle: "Nigeria",
    coordinates: [3.3792, 6.5244] as LngLat,
    zoom: 9.8,
    kind: "Major city",
  },
  {
    name: "London",
    subtitle: "United Kingdom",
    coordinates: [-0.1276, 51.5072] as LngLat,
    zoom: 9.6,
    kind: "Major city",
  },
  {
    name: "Nairobi",
    subtitle: "Kenya",
    coordinates: [36.8219, -1.2921] as LngLat,
    zoom: 9.7,
    kind: "Major city",
  },
  {
    name: "Tokyo",
    subtitle: "Japan",
    coordinates: [139.6917, 35.6895] as LngLat,
    zoom: 9.2,
    kind: "Major city",
  },
];

export default function HomePage() {
  const mapRef = useRef<GlobeMapHandle>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [activeNav, setActiveNav] = useState<"explore" | "nearby" | "saved">("explore");
  const [savedPlaces, setSavedPlaces] = useState<SelectedPlace[]>([]);
  const [projection, setProjection] = useState<"globe" | "flat">("globe");
  const [notice, setNotice] = useState("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [savedViewOpen, setSavedViewOpen] = useState(false);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 3600);
  }, []);

  useEffect(() => {
    function closeSearchOnOutsideClick(event: MouseEvent) {
      if (
        searchBoxRef.current &&
        event.target instanceof Node &&
        !searchBoxRef.current.contains(event.target)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", closeSearchOnOutsideClick);
    return () => {
      document.removeEventListener("mousedown", closeSearchOnOutsideClick);
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const selectPlace = useCallback(
    (place: SelectedPlace) => {
      setSelectedPlace(place);
      setActiveNav("explore");
      setSavedViewOpen(false);
      setMobilePanelOpen(true);
      setSearchOpen(false);
      mapRef.current?.flyTo(place.coordinates, place.zoom);
      mapRef.current?.setMarker(place.coordinates);
    },
    [],
  );

  const chooseSearchResult = useCallback(
    (result: PlaceSearchResult) => {
      const coordinates: LngLat = [Number(result.lon), Number(result.lat)];
      const place: SelectedPlace = {
        id: `${result.osm_type}-${result.osm_id}`,
        name: getPlaceTitle(result),
        subtitle: getPlaceSubtitle(result),
        displayName: result.display_name,
        kind: getPlaceKind(result),
        coordinates,
        zoom: getPlaceZoom(result),
      };
      setSearchValue(place.name);
      selectPlace(place);
    },
    [selectPlace],
  );

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchValue.trim();
    if (query.length < 2) {
      setSearchError("Enter at least two characters to search.");
      setSearchOpen(true);
      return;
    }

    setSearching(true);
    setSearchError("");
    setSearchResults([]);
    setSearchOpen(true);

    try {
      const results = await searchPlaces(query);
      setSearchResults(results);
      if (results.length === 0) {
        setSearchError("No matching places found. Try a city, street, or landmark.");
      }
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "Place search is unavailable right now. Please try again.",
      );
    } finally {
      setSearching(false);
    }
  }

  function chooseQuickPlace(place: (typeof QUICK_PLACES)[number]) {
    const selected: SelectedPlace = {
      id: `quick-${place.name.toLowerCase()}`,
      name: place.name,
      subtitle: place.subtitle,
      displayName: `${place.name}, ${place.subtitle}`,
      kind: place.kind,
      coordinates: place.coordinates,
      zoom: place.zoom,
    };
    setSearchValue(place.name);
    selectPlace(selected);
  }

  function toggleSavedPlace() {
    if (!selectedPlace) return;
    const alreadySaved = savedPlaces.some((place) => place.id === selectedPlace.id);

    if (alreadySaved) {
      setSavedPlaces((current) => current.filter((place) => place.id !== selectedPlace.id));
      showNotice("Removed from this session's saved places.");
    } else {
      setSavedPlaces((current) => [...current, selectedPlace]);
      showNotice("Place saved for this session. Saving across visits comes later.");
    }
  }

  function locateNearby() {
    setActiveNav("nearby");
    setSavedViewOpen(false);

    if (!("geolocation" in navigator)) {
      showNotice("This browser does not support location access.");
      return;
    }

    showNotice("Checking your location…");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates: LngLat = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        const selected: SelectedPlace = {
          id: "device-area-session",
          name: "Around you",
          subtitle: "Approximate area · this device only",
          displayName: "Your approximate area",
          kind: "Nearby area",
          coordinates,
          zoom: 13,
        };
        mapRef.current?.flyTo(coordinates, 13);
        mapRef.current?.setMarker(coordinates);
        setSelectedPlace(selected);
        setMobilePanelOpen(true);
        showNotice("Location used for this map view only. It has not been published.");
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. You can still search for any place."
            : error.code === error.TIMEOUT
              ? "Location check timed out. Try again or search for a place."
              : "Couldn't determine your location. Search for a place instead.";
        showNotice(message);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  function handleNavClick(nav: "explore" | "nearby" | "saved") {
    setActiveNav(nav);
    if (nav === "nearby") {
      locateNearby();
      return;
    }
    if (nav === "saved") {
      setSavedViewOpen(true);
      setSelectedPlace(null);
      setMobilePanelOpen(true);
      return;
    }
    setSavedViewOpen(false);
    setSelectedPlace(null);
    setMobilePanelOpen(false);
    mapRef.current?.resetView();
  }

  function toggleProjection() {
    const next = mapRef.current?.toggleProjection();
    if (next) setProjection(next);
  }

  const isCurrentPlaceSaved = useMemo(
    () => selectedPlace && savedPlaces.some((place) => place.id === selectedPlace.id),
    [savedPlaces, selectedPlace],
  );

  return (
    <main className="world-shell">
      <div className="map-background" aria-hidden="true">
        <GlobeMap ref={mapRef} onStatusChange={setMapStatus} />
      </div>
      <div className="map-shade" aria-hidden="true" />

      <header className="topbar">
        <button
          className="brand-lockup"
          type="button"
          onClick={() => handleNavClick("explore")}
          aria-label="THE WORLD home"
        >
          <span className="brand-mark"><Globe size={22} strokeWidth={1.7} /></span>
          <span className="brand-copy">
            <strong>THE WORLD</strong>
            <small>THE PLACES THAT CONNECT US</small>
          </span>
        </button>

        <div className="header-search-wrap" ref={searchBoxRef}>
          <form className="search-form" onSubmit={submitSearch} role="search">
            <Search size={19} className="search-icon" aria-hidden="true" />
            <input
              value={searchValue}
              onChange={(event) => {
                setSearchValue(event.target.value);
                if (searchOpen) {
                  setSearchResults([]);
                  setSearchError("");
                }
              }}
              onFocus={() => {
                if (searchResults.length || searchError) setSearchOpen(true);
              }}
              placeholder="Search any place on Earth..."
              aria-label="Search places around the world"
              autoComplete="off"
            />
            {searchValue && (
              <button
                type="button"
                className="search-clear"
                onClick={() => {
                  setSearchValue("");
                  setSearchResults([]);
                  setSearchError("");
                  setSearchOpen(false);
                }}
                aria-label="Clear search"
              >
                <X size={15} />
              </button>
            )}
            <button className="search-submit" type="submit" disabled={searching}>
              {searching ? <span className="mini-spinner" /> : <span>Explore</span>}
              {!searching && <ArrowUpRight size={15} />}
            </button>
          </form>

          {searchOpen && (searchResults.length > 0 || searching || searchError) && (
            <div className="search-results" role="listbox" aria-label="Place search results">
              {searching && (
                <div className="search-message">
                  <span className="mini-spinner" /> Finding places around the world…
                </div>
              )}
              {!searching && searchError && (
                <div className="search-message search-message-error">{searchError}</div>
              )}
              {!searching &&
                searchResults.map((result) => (
                  <button
                    key={`${result.osm_type}-${result.osm_id}`}
                    type="button"
                    className="search-result"
                    onClick={() => chooseSearchResult(result)}
                    role="option"
                    aria-selected="false"
                  >
                    <span className="result-icon"><MapPin size={17} /></span>
                    <span className="result-copy">
                      <strong>{getPlaceTitle(result)}</strong>
                      <small>{result.display_name}</small>
                    </span>
                    <ChevronRight size={16} className="result-arrow" />
                  </button>
                ))}
              <div className="search-attribution">
                Place search provided by OpenStreetMap contributors (Nominatim).
              </div>
            </div>
          )}
        </div>

        <div className="topbar-right">
          <span className="prototype-pill"><span /> PROTOTYPE</span>
          <div className="avatar-mark" aria-label="Guest preview"><Globe size={17} /></div>
          <button
            className="mobile-menu-button"
            type="button"
            onClick={() => setMobilePanelOpen((open) => !open)}
            aria-label="Toggle location panel"
          >
            <Menu size={19} />
          </button>
        </div>
      </header>

      <aside className="left-panel glass-panel">
        <div className="panel-kicker"><span className="kicker-dot" /> YOUR WORLD, OPEN</div>
        <h1>Every place has<br />a <em>story.</em></h1>
        <p className="intro-copy">
          Explore the real Earth. Discover the conversations connected to its places.
        </p>

        <nav className="primary-nav" aria-label="Main navigation">
          <button
            type="button"
            className={activeNav === "explore" ? "nav-item active" : "nav-item"}
            onClick={() => handleNavClick("explore")}
          >
            <Compass size={18} />
            <span>Explore</span>
            <ChevronRight size={15} className="nav-chevron" />
          </button>
          <button
            type="button"
            className={activeNav === "nearby" ? "nav-item active" : "nav-item"}
            onClick={() => handleNavClick("nearby")}
          >
            <LocateFixed size={18} />
            <span>Explore nearby</span>
            <span className="nav-new">HERE</span>
          </button>
          <button
            type="button"
            className={activeNav === "saved" ? "nav-item active" : "nav-item"}
            onClick={() => handleNavClick("saved")}
          >
            <Bookmark size={18} />
            <span>Saved places</span>
            <span className="saved-count">{savedPlaces.length || "—"}</span>
          </button>
        </nav>

        <div className="panel-divider" />

        <div className="section-heading">
          <div>
            <span className="eyebrow">A WORLD TO EXPLORE</span>
            <h2>Start somewhere</h2>
          </div>
          <Sparkles size={17} className="section-sparkle" />
        </div>

        <div className="quick-places">
          {QUICK_PLACES.map((place, index) => (
            <button
              className="quick-place"
              type="button"
              key={place.name}
              onClick={() => chooseQuickPlace(place)}
            >
              <span className={`place-symbol place-symbol-${index + 1}`}>
                {index === 0 ? "LA" : index === 1 ? "LDN" : index === 2 ? "NRB" : "TK"}
              </span>
              <span className="quick-place-copy">
                <strong>{place.name}</strong>
                <small>{place.subtitle}</small>
              </span>
              <ArrowUpRight size={15} className="quick-arrow" />
            </button>
          ))}
        </div>

        <div className="pulse-card">
          <div className="pulse-card-top">
            <span className="pulse-icon"><Radio size={16} /></span>
            <span className="eyebrow">WORLD PULSE</span>
            <span className="pulse-status">PREVIEW</span>
          </div>
          <strong>Your world is waiting.</strong>
          <p>Live conversations will appear here when community services are connected.</p>
          <div className="pulse-empty">
            <span className="pulse-empty-ring"><MessageCircle size={16} /></span>
            <span>No live activity in this test build</span>
          </div>
        </div>

        <div className="panel-footnote">
          <ShieldCheck size={14} />
          <span>Explore anywhere. Your exact location is never shown on the map.</span>
        </div>
      </aside>

      <section
        className={[
          "right-panel",
          "glass-panel",
          selectedPlace || savedViewOpen || mobilePanelOpen ? "right-panel-open" : "",
          mobilePanelOpen ? "mobile-panel-open" : "",
        ].filter(Boolean).join(" ")}
        aria-label="Selected place details"
      >
        <div className="right-panel-mobile-handle"><span /></div>
        {savedViewOpen ? (
          <div className="place-panel-content">
            <div className="place-panel-header">
              <div>
                <span className="eyebrow">YOUR COLLECTION</span>
                <h2>Saved places</h2>
              </div>
              <button type="button" className="icon-button" onClick={() => { setSavedViewOpen(false); setMobilePanelOpen(false); }} aria-label="Close saved places">
                <X size={17} />
              </button>
            </div>
            {savedPlaces.length === 0 ? (
              <div className="empty-state saved-empty">
                <span className="empty-illustration"><Bookmark size={22} /></span>
                <h3>Your world, bookmarked.</h3>
                <p>Save a place while exploring and it will appear here for this session.</p>
                <button className="outline-button" type="button" onClick={() => handleNavClick("explore")}>
                  Return to explore <ArrowRight size={15} />
                </button>
              </div>
            ) : (
              <div className="saved-list">
                {savedPlaces.map((place) => (
                  <button
                    key={place.id}
                    className="saved-place-row"
                    type="button"
                    onClick={() => selectPlace(place)}
                  >
                    <span className="saved-place-icon"><MapPin size={16} /></span>
                    <span><strong>{place.name}</strong><small>{place.subtitle}</small></span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                <p className="prototype-note">Saved places currently last for this browser session only.</p>
              </div>
            )}
          </div>
        ) : selectedPlace ? (
          <div className="place-panel-content">
            <div className="place-panel-header">
              <div>
                <span className="eyebrow"><span className="location-eyebrow-dot" /> PLACE SELECTED</span>
                <div className="place-type-line">{selectedPlace.kind}</div>
              </div>
              <button type="button" className="icon-button" onClick={() => { setSelectedPlace(null); setMobilePanelOpen(false); }} aria-label="Close place details">
                <X size={17} />
              </button>
            </div>

            <h2 className="selected-place-title">{selectedPlace.name}</h2>
            <p className="selected-place-subtitle">{selectedPlace.subtitle}</p>

            <div className="selected-place-address">
              <MapPin size={16} />
              <span>{selectedPlace.displayName}</span>
            </div>

            <div className="place-actions">
              <button
                type="button"
                className={isCurrentPlaceSaved ? "primary-action saved" : "primary-action"}
                onClick={toggleSavedPlace}
              >
                {isCurrentPlaceSaved ? <Check size={16} /> : <Bookmark size={16} />}
                {isCurrentPlaceSaved ? "Saved this session" : "Save this place"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => showNotice("Community posting and presence verification are the next build milestone.")}
              >
                <MessageCircle size={16} /> Community preview
              </button>
            </div>

            <div className="place-card-divider" />

            <div className="community-preview-heading">
              <div>
                <span className="eyebrow">THE WORLD COMMUNITY</span>
                <h3>Something starts here.</h3>
              </div>
              <span className="community-preview-symbol"><Globe size={18} /></span>
            </div>

            <div className="community-status-card">
              <span className="status-line"><span className="status-dot status-dot-pending" /> COMMUNITY PREVIEW</span>
              <p>
                This is a real mapped place. Its local conversations will appear here once the community API is connected.
              </p>
              <div className="community-status-footer">
                <span><ShieldCheck size={14} /> Location-aware by design</span>
                <span>STEP 01 / 04</span>
              </div>
            </div>

            <div className="next-step-card">
              <span className="next-step-icon"><Sparkles size={17} /></span>
              <span>
                <strong>Coming next</strong>
                <small>Local posts, replies, and presence verification.</small>
              </span>
              <ArrowDownRight size={17} />
            </div>
          </div>
        ) : (
          <div className="welcome-panel-content">
            <div className="welcome-orb"><Globe size={31} strokeWidth={1.2} /><span /></div>
            <span className="eyebrow">THE WORLD EXPLORER</span>
            <h2>More than a map.<br /><em>A world of stories.</em></h2>
            <p className="welcome-copy">
              Find a real place and step into the community that will grow around it.
            </p>
            <div className="welcome-instruction">
              <span className="instruction-number">01</span>
              <span><strong>Search the real world</strong><small>Try a street, city, or landmark.</small></span>
              <Search size={17} />
            </div>
            <div className="welcome-instruction">
              <span className="instruction-number">02</span>
              <span><strong>Open a place</strong><small>Fly straight to it on the globe.</small></span>
              <MapPin size={17} />
            </div>
            <div className="welcome-instruction">
              <span className="instruction-number">03</span>
              <span><strong>Explore its community</strong><small>Local conversations are the next milestone.</small></span>
              <MessageCircle size={17} />
            </div>
            <div className="welcome-tip">
              <span className="tip-icon"><ShieldCheck size={15} /></span>
              <p>Map exploration works without location permission. Your location is only requested when you choose to explore nearby.</p>
            </div>
            <button className="welcome-cta" type="button" onClick={() => chooseQuickPlace(QUICK_PLACES[0])}>
              Explore Lagos <ArrowRight size={17} />
            </button>
          </div>
        )}
      </section>

      <div className="map-status" aria-live="polite">
        <span className={mapStatus === "ready" ? "map-status-dot ready" : "map-status-dot"} />
        {mapStatus === "ready"
          ? "EARTH ONLINE"
          : mapStatus === "error"
            ? "MAP CONNECTION ISSUE"
            : "CONNECTING TO EARTH"}
      </div>

      {mapStatus === "error" && (
        <div className="map-error-card">
          <Globe size={19} />
          <div>
            <strong>Earth is taking a break.</strong>
            <p>We couldn't load the map. Check your connection and refresh the page to try again.</p>
          </div>
        </div>
      )}

      <div className="map-controls" aria-label="Map controls">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={17} /></button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={17} /></button>
        <span className="map-controls-divider" />
        <button type="button" onClick={() => { mapRef.current?.resetView(); setProjection("globe"); }} aria-label="Reset globe view"><RotateCcw size={16} /></button>
        <button
          type="button"
          className="projection-button"
          onClick={toggleProjection}
          aria-label="Toggle globe or flat map"
          title={projection === "globe" ? "Switch to flat map" : "Switch to globe"}
        >
          <Layers size={17} />
          <span>{projection === "globe" ? "3D" : "2D"}</span>
        </button>
      </div>

      <div className="map-bottom-caption">
        <span className="caption-pulse" />
        <span>REAL PLACES. REAL PEOPLE. ONE WORLD.</span>
      </div>

      {notice && (
        <div className="toast-message" role="status">
          <span className="toast-check"><Check size={15} /></span>
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="mobile-map-search-hint">
        <Navigation size={14} /> Search for any place on Earth
      </div>

      <footer className="prototype-footer">
        <span>THE WORLD · EXPLORER PREVIEW</span>
        <span>MAP DATA: OPENFREEMAP / OPENSTREETMAP</span>
      </footer>
    </main>
  );
}
