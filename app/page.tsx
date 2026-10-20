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
  LogIn,
  LogOut,
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
  Send,
  UserRound,
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
  reversePlace,
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

type SessionUser = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  createdAt: string;
};

type CommunityPost = {
  id: string;
  body: string;
  type: "thought" | "question" | "discovery" | "update";
  placeKey: string;
  placeName: string;
  author: { username: string; displayName: string };
  createdAt: string;
  presenceVerifiedAt: string | null;
};

function formatPostTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(timestamp));
}

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

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postType, setPostType] = useState<CommunityPost["type"]>("thought");
  const [postBusy, setPostBusy] = useState(false);

  const placeSupportsLiveHere = Boolean(
    selectedPlace && /^(node|way|relation)-[1-9]\\d{0,17}$/.test(selectedPlace.id),
  );

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 3600);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        setAuthConfigured(Boolean(payload.configured));
        setSessionUser(payload.user || null);
      })
      .catch(() => {
        if (!active) return;
        setAuthConfigured(false);
        setSessionUser(null);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const placeKey = selectedPlace?.id || "";
    if (!placeKey || !/^(node|way|relation)-[1-9]\\d{0,17}$/.test(placeKey)) {
      setCommunityPosts([]);
      setCommunityError("");
      setCommunityLoading(false);
      return;
    }

    setCommunityLoading(true);
    setCommunityError("");
    fetch(`/api/posts?placeKey=${encodeURIComponent(placeKey)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setCommunityPosts([]);
          setCommunityError(
            typeof payload.message === "string"
              ? payload.message
              : "The community feed is temporarily unavailable.",
          );
          return;
        }
        setCommunityPosts(Array.isArray(payload.posts) ? payload.posts as CommunityPost[] : []);
        setCommunityError("");
      })
      .catch(() => {
        if (!active) return;
        setCommunityPosts([]);
        setCommunityError("We couldn't load this community. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setCommunityLoading(false);
      });

    return () => { active = false; };
  }, [selectedPlace?.id]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");

    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authEmail,
          username: authUsername,
          password: authPassword,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.user) {
        setAuthError(
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't complete that request. Please try again.",
        );
        return;
      }

      setSessionUser(payload.user as SessionUser);
      setAuthConfigured(true);
      setAuthPassword("");
      setAuthModalOpen(false);
      setAuthError("");
      showNotice(authMode === "register" ? "Your THE WORLD account is ready." : "Welcome back.");
    } catch {
      setAuthError("The account service couldn't be reached. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
    } finally {
      setSessionUser(null);
      setAuthPassword("");
      setAuthModalOpen(false);
      showNotice("You've signed out.");
    }
  }

  async function handlePublishPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (postBusy || !selectedPlace) return;
    if (!sessionUser) {
      setAuthMode("login");
      setAuthModalOpen(true);
      return;
    }
    if (!placeSupportsLiveHere) {
      setCommunityError("Choose a named street or mapped place before posting to LIVE HERE.");
      return;
    }
    if (authConfigured !== true) {
      setCommunityError("Community storage is not connected yet. Configure MongoDB before posting.");
      return;
    }
    const body = postBody.trim();
    if (body.length < 2 || body.length > 500) {
      setCommunityError("A post must contain 2–500 characters.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setCommunityError("This browser doesn't support location checks. You can still explore public places.");
      return;
    }

    setPostBusy(true);
    setCommunityError("");
    showNotice("Checking your location…");

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
        );
      });

      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          type: postType,
          place: {
            placeKey: selectedPlace.id,
            name: selectedPlace.name,
            displayName: selectedPlace.displayName,
            kind: selectedPlace.kind,
            coordinates: selectedPlace.coordinates,
          },
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.post) {
        if (response.status === 401) {
          setSessionUser(null);
          setAuthMode("login");
          setAuthModalOpen(true);
        }
        setCommunityError(
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't publish your post. Please try again.",
        );
        return;
      }

      setCommunityPosts((current) => [
        payload.post as CommunityPost,
        ...current.filter((post) => post.id !== payload.post.id),
      ].slice(0, 30));
      setPostBody("");
      showNotice("Your contribution is now in this place's community.");
    } catch (error) {
      const locationError = error as GeolocationPositionError;
      if (locationError?.code === 1) {
        setCommunityError("Location permission was denied. Allow location access to post here.");
      } else if (locationError?.code === 3) {
        setCommunityError("The location check timed out. Try again where your GPS signal is clearer.");
      } else {
        setCommunityError("We couldn't verify your location or reach the server. Please try again.");
      }
    } finally {
      setPostBusy(false);
    }
  }

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

  const mapTapRequestRef = useRef(0);

  const handleMapClick = useCallback(
    async (coordinates: LngLat) => {
      const requestId = ++mapTapRequestRef.current;
      const [longitude, latitude] = coordinates;
      showNotice("Looking up this place…");

      try {
        const result = await reversePlace(latitude, longitude);
        if (requestId !== mapTapRequestRef.current) return;
        if (result) {
          const selected: SelectedPlace = {
            id: `${result.osm_type}-${result.osm_id}`,
            name: getPlaceTitle(result),
            subtitle: getPlaceSubtitle(result),
            displayName: result.display_name,
            kind: getPlaceKind(result),
            coordinates,
            zoom: 15.5,
          };
          setSearchValue(selected.name);
          selectPlace(selected);
          showNotice("Place opened. Its community preview is ready to explore.");
          return;
        }
        const selected: SelectedPlace = {
          id: `map-${latitude.toFixed(4)}-${longitude.toFixed(4)}`,
          name: "Unnamed map location",
          subtitle: "No nearby named feature was found",
          displayName: `Approximate map point: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
          kind: "Map location",
          coordinates,
          zoom: 15.5,
        };
        setSearchValue("");
        selectPlace(selected);
        showNotice("Opened this map point. A named place could not be found nearby.");
      } catch (error) {
        if (requestId !== mapTapRequestRef.current) return;
        showNotice(error instanceof Error ? error.message : "Couldn't look up this point. You can still search for a place.");
      }
    },
    [selectPlace, showNotice],
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
        <GlobeMap
            ref={mapRef}
            onStatusChange={setMapStatus}
            onMapClick={(coordinates) => { void handleMapClick(coordinates); }}
          />
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
          <button
            className="avatar-mark account-button"
            type="button"
            onClick={() => { setAuthError(""); setAuthModalOpen(true); }}
            aria-label={sessionUser ? `Account @${sessionUser.username}` : "Sign in or create an account"}
            title={sessionUser ? `@${sessionUser.username}` : "Sign in"}
          >
            {sessionUser ? <span className="account-initial">{sessionUser.username.slice(0, 1).toUpperCase()}</span> : <UserRound size={17} />}
            <span className="account-label">{sessionUser ? `@${sessionUser.username}` : "Sign in"}</span>
          </button>
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
                <span className="eyebrow">LIVE HERE / COMMUNITY</span>
                <h3>{communityPosts.length > 0 ? `${communityPosts.length} recent conversation${communityPosts.length === 1 ? "" : "s"}` : "Start the conversation"}</h3>
              </div>
              <span className="community-preview-symbol"><Radio size={18} /></span>
            </div>

            {!placeSupportsLiveHere ? (
              <div className="community-status-card">
                <span className="status-line"><span className="status-dot status-dot-pending" /> PLACE PREVIEW</span>
                <p>Choose a named street or mapped place from search, or tap a named feature on the map, to open its live community. Major-city shortcuts are for exploration only.</p>
                <div className="community-status-footer">
                  <span><ShieldCheck size={14} /> No location is published</span>
                  <span>EXPLORE</span>
                </div>
              </div>
            ) : communityLoading ? (
              <div className="community-loading-card">
                <span className="mini-spinner" />
                <span>Loading this place's community…</span>
              </div>
            ) : communityError ? (
              <div className="community-error-card" role="status">
                <ShieldCheck size={17} />
                <div>
                  <strong>Community status</strong>
                  <p>{communityError}</p>
                </div>
              </div>
            ) : communityPosts.length === 0 ? (
              <div className="community-empty-card">
                <span className="community-empty-icon"><MessageCircle size={19} /></span>
                <strong>No conversations here yet.</strong>
                <p>Once MongoDB is connected, the first verified local contribution can start this place's community.</p>
              </div>
            ) : (
              <div className="community-post-list">
                {communityPosts.map((post) => (
                  <article className="community-post-card" key={post.id}>
                    <div className="community-post-top">
                      <span className="community-post-avatar">{(post.author.displayName || post.author.username || "W").slice(0, 1).toUpperCase()}</span>
                      <div className="community-post-author">
                        <strong>{post.author.displayName || post.author.username}</strong>
                        <small>@{post.author.username} · {formatPostTime(post.createdAt)}</small>
                      </div>
                      <span className={`community-post-type type-${post.type}`}>{post.type}</span>
                    </div>
                    <p className="community-post-body">{post.body}</p>
                    <div className="community-post-footer">
                      <span><MapPin size={12} /> {post.placeName || selectedPlace?.name}</span>
                      {post.presenceVerifiedAt && <span><ShieldCheck size={12} /> Presence checked</span>}
                    </div>
                  </article>
                ))}
              </div>
            )}

            <div className="post-composer-card">
              <div className="post-composer-heading">
                <span className="composer-icon"><MessageCircle size={16} /></span>
                <div>
                  <strong>Add your voice</strong>
                  <small>{sessionUser ? `Posting as @${sessionUser.username}` : "Sign in to contribute to the community"}</small>
                </div>
              </div>

              {sessionUser ? (
                <form className="community-post-form" onSubmit={handlePublishPost}>
                  <select
                    value={postType}
                    onChange={(event) => setPostType(event.target.value as CommunityPost["type"])}
                    aria-label="Post type"
                    disabled={postBusy}
                  >
                    <option value="thought">Thought</option>
                    <option value="question">Question</option>
                    <option value="discovery">Local discovery</option>
                    <option value="update">Current update</option>
                  </select>
                  <textarea
                    value={postBody}
                    onChange={(event) => setPostBody(event.target.value.slice(0, 500))}
                    placeholder="What's worth sharing about this place?"
                    maxLength={500}
                    rows={3}
                    aria-label="Your local post"
                    disabled={postBusy || !placeSupportsLiveHere || authConfigured !== true}
                  />
                  <div className="post-composer-bottom">
                    <span>{postBody.length}/500 · Location check required</span>
                    <button type="submit" disabled={postBusy || postBody.trim().length < 2 || !placeSupportsLiveHere || authConfigured !== true}>
                      {postBusy ? <span className="mini-spinner" /> : <Send size={14} />}
                      {postBusy ? "Checking…" : "Post here"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="post-signin-prompt">
                  <p>Create a free account to contribute. The browser will request your location only when you submit a LIVE HERE post.</p>
                  <button type="button" onClick={() => { setAuthMode("register"); setAuthError(""); setAuthModalOpen(true); }} disabled={authConfigured === false}>
                    <LogIn size={15} /> Create account
                  </button>
                </div>
              )}
              <div className="presence-note">
                <ShieldCheck size={13} />
                <span>Your exact coordinates are not published. This prototype uses a proximity check against the selected map point; it is not proof against GPS spoofing.</span>
              </div>
            </div>
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
              <span><strong>Search or tap the map</strong><small>Choose a street, city, landmark, or point on Earth.</small></span>
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
        <Navigation size={14} /> Tap the map or search for any place
      </div>

      <footer className="prototype-footer">
        <span>THE WORLD · EXPLORER PREVIEW</span>
        <span>MAP DATA: OPENFREEMAP / OPENSTREETMAP</span>
      </footer>
      {authModalOpen && (
        <div className="auth-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !authBusy) setAuthModalOpen(false);
        }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button
              className="auth-close icon-button"
              type="button"
              onClick={() => setAuthModalOpen(false)}
              aria-label="Close account dialog"
              disabled={authBusy}
            >
              <X size={17} />
            </button>

            {sessionUser ? (
              <div className="auth-account-view">
                <span className="auth-modal-mark"><UserRound size={22} /></span>
                <span className="eyebrow">YOUR WORLD IDENTITY</span>
                <h2 id="auth-title">You're signed in.</h2>
                <p className="auth-intro">Your account can contribute to a local community when your presence check passes.</p>
                <div className="auth-user-card">
                  <span className="account-initial">{sessionUser.username.slice(0, 1).toUpperCase()}</span>
                  <span><strong>@{sessionUser.username}</strong><small>{sessionUser.email}</small></span>
                </div>
                <button className="auth-submit auth-logout" type="button" onClick={() => void handleSignOut()}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            ) : (
              <>
                <span className="auth-modal-mark"><Globe size={22} /></span>
                <span className="eyebrow">JOIN THE WORLD</span>
                <h2 id="auth-title">{authMode === "register" ? "Find your place." : "Welcome back."}</h2>
                <p className="auth-intro">{authMode === "register" ? "Create an account to contribute to communities connected to real places." : "Sign in to continue your conversations around the world."}</p>

                {authConfigured === false && (
                  <div className="auth-config-note">
                    <strong>Database setup needed</strong>
                    <p>Accounts and posts need MongoDB. Add MONGODB_URI and MONGODB_DB to your Vercel project environment before testing sign-in.</p>
                  </div>
                )}

                <form className="auth-form" onSubmit={handleAuthSubmit}>
                  {authMode === "register" && (
                    <label>
                      <span>Username</span>
                      <input
                        value={authUsername}
                        onChange={(event) => setAuthUsername(event.target.value.toLowerCase())}
                        autoComplete="username"
                        minLength={3}
                        maxLength={20}
                        pattern="[a-z0-9_]{3,20}"
                        placeholder="your_username"
                        required
                        disabled={authBusy || authConfigured === false}
                      />
                    </label>
                  )}
                  <label>
                    <span>Email address</span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      autoComplete="email"
                      maxLength={254}
                      placeholder="you@example.com"
                      required
                      disabled={authBusy || authConfigured === false}
                    />
                  </label>
                  <label>
                    <span>Password</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      autoComplete={authMode === "register" ? "new-password" : "current-password"}
                      minLength={authMode === "register" ? 10 : 1}
                      maxLength={128}
                      placeholder={authMode === "register" ? "At least 10 characters" : "Your password"}
                      required
                      disabled={authBusy || authConfigured === false}
                    />
                  </label>
                  {authError && <p className="auth-error" role="alert">{authError}</p>}
                  <button className="auth-submit" type="submit" disabled={authBusy || authConfigured === false}>
                    {authBusy ? <span className="mini-spinner" /> : authMode === "register" ? <UserRound size={16} /> : <LogIn size={16} />}
                    {authBusy ? "Please wait…" : authMode === "register" ? "Create account" : "Sign in"}
                  </button>
                </form>
                <button
                  className="auth-mode-switch"
                  type="button"
                  onClick={() => { setAuthError(""); setAuthMode(authMode === "register" ? "login" : "register"); }}
                  disabled={authBusy || authConfigured === false}
                >
                  {authMode === "register" ? "Already have an account? Sign in" : "New to THE WORLD? Create an account"}
                </button>
                <p className="auth-small-print">Prototype accounts use secure server-side sessions. Use a unique password; email verification and production abuse controls are not implemented yet.</p>
              </>
            )}
          </section>
        </div>
      )}

    </main>
  );
}
