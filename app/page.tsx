"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  Building2,
  Check,
  ChevronRight,
  ChevronDown,
  Compass,
  Globe,
  Heart,
  Flag,
  Pencil,
  Trash2,
  Share2,
  RefreshCw,
  Filter,
  Star,
  MessageSquare,
  Layers,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  Maximize2,
  Minimize2,
  Menu,
  MessageCircle,
  Minus,
  Navigation,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
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
  type ChangeEvent,
  type FormEvent,
} from "react";
import BusinessDirectory, { type BusinessTagOption } from "@/components/business-directory";
import NearbyCommunities from "@/components/nearby-communities";
import Google3DMap from "@/components/google-3d-map";
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

type FollowedPlace = {
  placeKey: string;
  name: string;
  displayName: string;
  subtitle: string;
  kind: string;
  coordinates: LngLat;
  zoom: number;
  followedAt: string;
};

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
  bio: string;
  createdAt: string;
};

type CommunityPost = {
  id: string;
  body: string;
  type: "thought" | "question" | "discovery" | "update";
  isRemoteQuestion: boolean;
  taggedBusinesses: { businessId: string; name: string }[];
  images?: { id: string; url: string }[];
  editedAt?: string | null;
  placeKey: string;
  placeName: string;
  author: { username: string; displayName: string };
  createdAt: string;
  presenceVerifiedAt: string | null;
  replyCount: number;
  likesCount: number;
  isLiked: boolean;
  isBookmarked: boolean;
};

type SavedBookmark = {
  id: string;
  savedAt: string;
  post: {
    id: string;
    body: string;
    type: string;
    placeKey: string;
    placeName: string;
    placeDisplayName: string;
    coordinates: LngLat | null;
    author: { username: string; displayName: string };
    createdAt: string;
    likesCount: number;
    replyCount: number;
  };
};

type WorldNotification = {
  id: string;
  type: "reply" | "like" | "new_post";
  actor: { username: string; displayName: string };
  postId: string;
  placeKey: string;
  placeName: string;
  coordinates: LngLat | null;
  createdAt: string;
  readAt: string | null;
};

type ReportTarget = { targetType: "post" | "reply"; targetId: string; authorUsername: string; body: string; placeName: string };
type ReportReason = "spam" | "harassment" | "misinformation" | "unsafe" | "privacy" | "other";

type CommunityReply = {
  id: string;
  postId: string;
  body: string;
  editedAt?: string | null;
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

const GOOGLE_3D_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

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
  const [mapProvider, setMapProvider] = useState<"globe" | "google-3d">("globe");
  const [notice, setNotice] = useState("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobilePanelExpanded, setMobilePanelExpanded] = useState(false);
  const placePanelRef = useRef<HTMLElement | null>(null);
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
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [savedPosts, setSavedPosts] = useState<SavedBookmark[]>([]);
  const [followedPlaces, setFollowedPlaces] = useState<FollowedPlace[]>([]);
  const [followedPlacesExpanded, setFollowedPlacesExpanded] = useState(false);
  const [followedPlacesBusy, setFollowedPlacesBusy] = useState(false);
  const [followedPlacesError, setFollowedPlacesError] = useState("");
  const [followActionBusy, setFollowActionBusy] = useState(false);

  const [savedPostsExpanded, setSavedPostsExpanded] = useState(false);
  const [savedPostsBusy, setSavedPostsBusy] = useState(false);
  const [savedPostsError, setSavedPostsError] = useState("");
  const [notifications, setNotifications] = useState<WorldNotification[]>([]);
  const [notificationsUnread, setNotificationsUnread] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");

  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");

  const [communityPosts, setCommunityPosts] = useState<CommunityPost[]>([]);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityLoadingMore, setCommunityLoadingMore] = useState(false);
  const [communityHasMore, setCommunityHasMore] = useState(false);
  const [communityCursor, setCommunityCursor] = useState<string | null>(null);
  const [communityTotalCount, setCommunityTotalCount] = useState(0);
  const [communityRefreshVersion, setCommunityRefreshVersion] = useState(0);
  const [communityError, setCommunityError] = useState("");
  const [communitySection, setCommunitySection] = useState<"conversations" | "businesses" | "nearby">("conversations");
  const [communityFilter, setCommunityFilter] = useState<"all" | "question" | "discovery" | "update" | "unanswered">("all");
  const [communityConversationOnly, setCommunityConversationOnly] = useState(false);
  const [availableBusinessTags, setAvailableBusinessTags] = useState<BusinessTagOption[]>([]);
  const [taggedBusinessIds, setTaggedBusinessIds] = useState<string[]>([]);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingPostBody, setEditingPostBody] = useState("");
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyBody, setEditingReplyBody] = useState("");
  const [pinnedConversation, setPinnedConversation] = useState<CommunityPost | null>(null);
  const [followedActivity, setFollowedActivity] = useState<Array<{ id: string; body: string; placeKey: string; placeName: string; author: { username: string; displayName: string }; createdAt: string; replyCount: number; isRemoteQuestion: boolean }>>([]);
  const [followedActivityBusy, setFollowedActivityBusy] = useState(false);
  const [followedActivityError, setFollowedActivityError] = useState("");
  const [followedActivityRefresh, setFollowedActivityRefresh] = useState(0);
  const [postBody, setPostBody] = useState("");
  const [selectedPostImages, setSelectedPostImages] = useState<Array<{ file: File; previewUrl: string }>>([]);
  const selectedPostImagesRef = useRef<Array<{ file: File; previewUrl: string }>>([]);
  const [postType, setPostType] = useState<CommunityPost["type"]>("thought");
  const [askFromElsewhere, setAskFromElsewhere] = useState(false);
  const [postBusy, setPostBusy] = useState(false);
  const [postError, setPostError] = useState("");

  const [replyThreadPostId, setReplyThreadPostId] = useState<string | null>(null);
  const [repliesByPost, setRepliesByPost] = useState<Record<string, CommunityReply[]>>({});
  const [replyLoadingPostId, setReplyLoadingPostId] = useState<string | null>(null);
  const [replyHasMoreByPost, setReplyHasMoreByPost] = useState<Record<string, boolean>>({});
  const [replyCursorByPost, setReplyCursorByPost] = useState<Record<string, string | null>>({});
  const [replyLoadingOlderPostId, setReplyLoadingOlderPostId] = useState<string | null>(null);
  const [replyBusyPostId, setReplyBusyPostId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [replyError, setReplyError] = useState("");
  const replyRequestRef = useRef(0);
  const deepLinkRequestRef = useRef(0);

  const placeSupportsLiveHere = Boolean(
    selectedPlace && /^(node|way|relation)-[1-9]\d{0,17}$/.test(selectedPlace.id),
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
    setProfileDisplayName(sessionUser?.displayName ?? "");
    setProfileBio(sessionUser?.bio ?? "");
    setProfileError("");
  }, [sessionUser?.id, sessionUser?.displayName, sessionUser?.bio]);

  useEffect(() => {
    if (!sessionUser?.id) {
      setFollowedPlaces([]);
      setFollowedPlacesError("");
      setFollowedPlacesExpanded(false);
      return;
    }

    const controller = new AbortController();
    setFollowedPlacesBusy(true);
    fetch("/api/followed-places", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Followed places are unavailable.");
        setFollowedPlaces(Array.isArray(payload.places) ? payload.places as FollowedPlace[] : []);
        setFollowedPlacesError("");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setFollowedPlacesError(error instanceof Error ? error.message : "Followed places are unavailable.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setFollowedPlacesBusy(false);
      });
    return () => controller.abort();
  }, [sessionUser?.id]);

  useEffect(() => {
    let active = true;
    if (!sessionUser?.id) {
      setFollowedActivity([]);
      setFollowedActivityError("");
      setFollowedActivityBusy(false);
      return () => { active = false; };
    }
    if (followedPlaces.length === 0) {
      setFollowedActivity([]);
      setFollowedActivityError("");
      setFollowedActivityBusy(false);
      return () => { active = false; };
    }
    setFollowedActivityBusy(true);
    setFollowedActivityError("");
    fetch("/api/followed-places/activity", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Followed activity is unavailable.");
        setFollowedActivity(Array.isArray(payload.activity) ? payload.activity : []);
      })
      .catch((error: unknown) => {
        if (active) setFollowedActivityError(error instanceof Error ? error.message : "Followed activity is unavailable.");
      })
      .finally(() => { if (active) setFollowedActivityBusy(false); });
    return () => { active = false; };
  }, [sessionUser?.id, followedPlaces.length, followedActivityRefresh]);

  useEffect(() => {
    let active = true;
    if (!sessionUser?.id) {
      setNotifications([]);
      setNotificationsUnread(0);
      setNotificationsOpen(false);
      setNotificationsError("");
      return () => { active = false; };
    }

    const loadNotifications = async () => {
      setNotificationsBusy(true);
      try {
        const response = await fetch("/api/notifications", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setNotificationsError(typeof payload.error === "string" ? payload.error : "Notifications are unavailable.");
          return;
        }
        setNotifications(Array.isArray(payload.notifications) ? payload.notifications as WorldNotification[] : []);
        setNotificationsUnread(typeof payload.unreadCount === "number" ? payload.unreadCount : 0);
        setNotificationsError("");
      } catch {
        if (active) setNotificationsError("Couldn't refresh notifications. Check your connection.");
      } finally {
        if (active) setNotificationsBusy(false);
      }
    };

    void loadNotifications();
    const interval = window.setInterval(() => { void loadNotifications(); }, 60000);
    return () => { active = false; window.clearInterval(interval); };
  }, [sessionUser?.id]);

  useEffect(() => {
    let active = true;
    const placeKey = selectedPlace?.id || "";
    if (!placeKey || !/^(node|way|relation)-[1-9]\\d{0,17}$/.test(placeKey)) {
      setCommunityPosts([]);
      setCommunityError("");
      setCommunityLoading(false);
      setCommunityHasMore(false);
      setCommunityCursor(null);
      setCommunityTotalCount(0);
      return;
    }

    setCommunityLoading(true);
    setCommunityError("");
    setCommunityPosts([]);
    setCommunityCursor(null);
    setCommunityHasMore(false);
    setCommunityTotalCount(0);
    const params = new URLSearchParams({ placeKey });
    if (communityFilter === "unanswered") {
      params.set("type", "question");
      params.set("unanswered", "1");
    } else if (communityFilter !== "all") {
      params.set("type", communityFilter);
    }
    fetch("/api/posts?" + params.toString(), { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setCommunityPosts([]);
          setCommunityError(typeof payload.message === "string" ? payload.message : "The community feed is temporarily unavailable.");
          return;
        }
        let loaded = Array.isArray(payload.posts) ? payload.posts as CommunityPost[] : [];
        const pinned = pinnedConversation;
        if (pinned && pinned.placeKey === placeKey && !loaded.some((post) => post.id === pinned.id)) loaded = [pinned, ...loaded];
        setCommunityPosts(loaded);
        setCommunityHasMore(payload.hasMore === true);
        setCommunityCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
        setCommunityTotalCount(typeof payload.totalCount === "number" ? payload.totalCount : loaded.length);
        setCommunityError("");
      })
      .catch(() => {
        if (!active) return;
        setCommunityPosts([]);
        setCommunityError("We couldn't load this community. Check your connection and try again.");
      })
      .finally(() => { if (active) setCommunityLoading(false); });

    return () => { active = false; };
  }, [selectedPlace?.id, sessionUser?.id, communityFilter, communityRefreshVersion, pinnedConversation?.id]);

  const handleBusinessTagsChange = useCallback((items: BusinessTagOption[]) => {
    setAvailableBusinessTags(items);
    setTaggedBusinessIds((current) => current.filter((id) => items.some((item) => item.businessId === id)).slice(0, 3));
  }, []);

  async function loadMoreCommunityPosts() {
    if (!selectedPlace || !communityCursor || communityLoadingMore || !communityHasMore) return;
    setCommunityLoadingMore(true);
    try {
      const params = new URLSearchParams({ placeKey: selectedPlace.id, before: communityCursor });
      if (communityFilter === "unanswered") {
        params.set("type", "question");
        params.set("unanswered", "1");
      } else if (communityFilter !== "all") {
        params.set("type", communityFilter);
      }
      const response = await fetch("/api/posts?" + params.toString(), { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.message === "string" ? payload.message : "Older conversations couldn't be loaded.");
      const older = Array.isArray(payload.posts) ? payload.posts as CommunityPost[] : [];
      setCommunityPosts((current) => {
        const ids = new Set(current.map((post) => post.id));
        return [...current, ...older.filter((post) => !ids.has(post.id))];
      });
      setCommunityCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
      setCommunityHasMore(payload.hasMore === true);
      setCommunityTotalCount(typeof payload.totalCount === "number" ? payload.totalCount : communityTotalCount);
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : "Older conversations couldn't be loaded.");
    } finally {
      setCommunityLoadingMore(false);
    }
  }

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

  async function handleProfileSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileBusy || !sessionUser) return;
    const displayName = profileDisplayName.trim();
    const bio = profileBio.trim();
    if (displayName.length < 2 || displayName.length > 40) {
      setProfileError("Display name must contain 2–40 characters.");
      return;
    }
    if (bio.length > 160) {
      setProfileError("Your bio must be 160 characters or fewer.");
      return;
    }

    setProfileBusy(true);
    setProfileError("");
    try {
      const response = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, bio }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.user) {
        setProfileError(typeof payload.error === "string" ? payload.error : "We couldn't save your profile.");
        return;
      }
      setSessionUser(payload.user as SessionUser);
      showNotice("Profile saved.");
    } catch {
      setProfileError("The profile service couldn't be reached. Please try again.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function toggleSavedPosts() {
    if (!sessionUser) {
      setAuthMode("login");
      setAuthModalOpen(true);
      return;
    }
    if (savedPostsExpanded) {
      setSavedPostsExpanded(false);
      return;
    }
    setSavedPostsExpanded(true);
    setSavedPostsBusy(true);
    setSavedPostsError("");
    try {
      const response = await fetch("/api/bookmarks", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSavedPostsError(typeof payload.error === "string" ? payload.error : "Saved posts couldn't be loaded.");
        return;
      }
      setSavedPosts(Array.isArray(payload.bookmarks) ? payload.bookmarks as SavedBookmark[] : []);
    } catch {
      setSavedPostsError("The saved-post service couldn't be reached. Please try again.");
    } finally {
      setSavedPostsBusy(false);
    }
  }

  async function handlePostAction(post: CommunityPost, kind: "like" | "bookmark") {
    if (!sessionUser) {
      setAuthMode("login");
      setAuthError("");
      setAuthModalOpen(true);
      return;
    }
    if (authConfigured !== true) {
      showNotice("Post interactions need the connected database. Please try again shortly.");
      return;
    }
    const action = kind === "like"
      ? (post.isLiked ? "unlike" : "like")
      : (post.isBookmarked ? "unbookmark" : "bookmark");
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(post.id)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          setSessionUser(null);
          setAuthMode("login");
          setAuthModalOpen(true);
        }
        showNotice(typeof payload.error === "string" ? payload.error : "That post action failed. Try again.");
        return;
      }
      setCommunityPosts((current) => current.map((item) => item.id === post.id ? {
        ...item,
        likesCount: typeof payload.likesCount === "number" ? payload.likesCount : item.likesCount,
        isLiked: typeof payload.isLiked === "boolean" ? payload.isLiked : item.isLiked,
        isBookmarked: typeof payload.isBookmarked === "boolean" ? payload.isBookmarked : item.isBookmarked,
      } : item));
      if (kind === "bookmark") {
        setSavedPosts([]);
        setSavedPostsExpanded(false);
      }
      showNotice(kind === "like"
        ? (payload.isLiked ? "Added your like." : "Like removed.")
        : (payload.isBookmarked ? "Post saved to your bookmarks." : "Removed from saved posts."));
    } catch {
      showNotice("Couldn't update that post. Check your connection and try again.");
    }
  }

  async function saveEditedPost(event: FormEvent<HTMLFormElement>, post: CommunityPost) {
    event.preventDefault();
    const body = editingPostBody.trim();
    if (body.length < 2 || body.length > 500 || !sessionUser) return;
    setPostBusy(true);
    setPostError("");
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We couldn't save this edit.");
      const editedAt = typeof payload.editedAt === "string" ? payload.editedAt : new Date().toISOString();
      setCommunityPosts((current) => current.map((item) => item.id === post.id ? { ...item, body, editedAt } : item));
      setPinnedConversation((current) => current?.id === post.id ? { ...current, body, editedAt } : current);
      setEditingPostId(null);
      setEditingPostBody("");
      showNotice("Your post was updated.");
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "We couldn't save this edit.");
    } finally {
      setPostBusy(false);
    }
  }

  async function deletePost(post: CommunityPost) {
    if (!sessionUser || !window.confirm("Delete this post? This removes it from the public conversation feed.")) return;
    setPostBusy(true);
    setPostError("");
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id), { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We couldn't delete this post.");
      setCommunityPosts((current) => current.filter((item) => item.id !== post.id));
      setCommunityTotalCount((count) => Math.max(0, count - 1));
      if (pinnedConversation?.id === post.id) setPinnedConversation(null);
      if (replyThreadPostId === post.id) setReplyThreadPostId(null);
      showNotice("Post deleted.");
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "We couldn't delete this post.");
    } finally {
      setPostBusy(false);
    }
  }

  async function sharePost(post: CommunityPost) {
    const url = new URL(window.location.origin + "/");
    url.searchParams.set("place", post.placeKey);
    url.searchParams.set("post", post.id);
    url.searchParams.set("view", "conversation");
    try {
      if (navigator.share) {
        await navigator.share({ title: post.placeName + " conversation on THE WORLD", text: post.body, url: url.toString() });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url.toString());
        showNotice("Conversation link copied.");
      } else {
        window.prompt("Copy this conversation link", url.toString());
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") showNotice("Couldn't share this conversation. Try copying its link.");
    }
  }

  async function saveEditedReply(event: FormEvent<HTMLFormElement>, post: CommunityPost, reply: CommunityReply) {
    event.preventDefault();
    const body = editingReplyBody.trim();
    if (body.length < 2 || body.length > 300) return;
    setReplyBusyPostId(post.id);
    setReplyError("");
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id) + "/replies/" + encodeURIComponent(reply.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We couldn't save this reply.");
      setRepliesByPost((current) => ({
        ...current,
        [post.id]: (current[post.id] || []).map((item) => item.id === reply.id
          ? { ...item, body, editedAt: typeof payload.editedAt === "string" ? payload.editedAt : new Date().toISOString() }
          : item),
      }));
      setEditingReplyId(null);
      setEditingReplyBody("");
      showNotice("Reply updated.");
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "We couldn't save this reply.");
    } finally { setReplyBusyPostId(null); }
  }

  async function deleteReply(post: CommunityPost, reply: CommunityReply) {
    if (!window.confirm("Delete your reply?")) return;
    setReplyBusyPostId(post.id);
    setReplyError("");
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id) + "/replies/" + encodeURIComponent(reply.id), { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We couldn't delete this reply.");
      setRepliesByPost((current) => ({ ...current, [post.id]: (current[post.id] || []).filter((item) => item.id !== reply.id) }));
      setCommunityPosts((current) => current.map((item) => item.id === post.id ? { ...item, replyCount: Math.max(0, (item.replyCount || 0) - 1) } : item));
      showNotice("Reply deleted.");
    } catch (error) { setReplyError(error instanceof Error ? error.message : "We couldn't delete this reply."); }
    finally { setReplyBusyPostId(null); }
  }

  async function exploreBroaderArea() {
    if (!selectedPlace) return;
    const parts = selectedPlace.displayName.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return;
    const query = parts.slice(1, Math.min(parts.length, 3)).join(", ");
    try {
      const results = await searchPlaces(query);
      const candidate = results.find((result) => {
        const title = getPlaceTitle(result).toLocaleLowerCase();
        return title !== selectedPlace.name.toLocaleLowerCase() && parts.slice(1, 3).some((part) => title === part.toLocaleLowerCase());
      }) ?? results[0];
      if (candidate && selectedPlace.id !== candidate.osm_type + "-" + candidate.osm_id) {
        chooseSearchResult(candidate);
      } else showNotice("We couldn't identify a broader mapped community for this place yet.");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "The broader place couldn't be opened.");
    }
  }

  async function handleNotificationRead(notification: WorldNotification) {
    if (!notification.readAt) {
      try {
        const response = await fetch("/api/notifications", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notificationId: notification.id }),
        });
        if (response.ok) {
          const readAt = new Date().toISOString();
          setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, readAt } : item));
          setNotificationsUnread((current) => Math.max(0, current - 1));
        }
      } catch {
        setNotificationsError("Couldn't mark this notification as read.");
      }
    }
    setNotificationsOpen(false);
    if (notification.coordinates && /^(node|way|relation)-[1-9]\d{0,17}$/.test(notification.placeKey)) {
      const params = new URLSearchParams({ place: notification.placeKey });
      if (/^[a-f\d]{24}$/i.test(notification.postId)) {
        params.set("post", notification.postId);
        params.set("view", "conversation");
      }
      window.location.href = "/?" + params.toString();
      return;
    }
    setSearchValue(notification.placeName);
    setSearchOpen(true);
    showNotice("Search for " + notification.placeName + " to return to this conversation.");
  }

  async function markAllNotificationsRead() {
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      if (!response.ok) throw new Error("Notification update failed");
      setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setNotificationsUnread(0);
      setNotificationsError("");
    } catch {
      setNotificationsError("Couldn't mark notifications as read. Please try again.");
    }
  }

  function openReport(target: ReportTarget) {
    if (!sessionUser) {
      setAuthMode("login");
      setAuthModalOpen(true);
      showNotice("Sign in to report content to the community team.");
      return;
    }
    if (target.authorUsername === sessionUser.username) {
      showNotice("You can't report your own content.");
      return;
    }
    setReportTarget(target);
    setReportReason("spam");
    setReportDetails("");
    setReportError("");
  }

  async function handleReportSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = reportTarget;
    if (!target || reportBusy) return;
    setReportBusy(true);
    setReportError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetType: target.targetType,
          targetId: target.targetId,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setReportError(typeof payload.error === "string" ? payload.error : "We couldn't send this report. Please try again.");
        return;
      }
      setReportTarget(null);
      setReportDetails("");
      setReportError("");
      showNotice(typeof payload.message === "string" ? payload.message : "Thank you for helping keep THE WORLD useful.");
    } catch {
      setReportError("The reporting service couldn't be reached. Please try again.");
    } finally {
      setReportBusy(false);
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

  async function toggleReplyThread(post: CommunityPost) {
    if (replyThreadPostId === post.id) {
      setReplyThreadPostId(null);
      setReplyError("");
      setReplyBody("");
      return;
    }

    const requestId = ++replyRequestRef.current;
    setReplyThreadPostId(post.id);
    setReplyError("");
    setReplyBody("");

    if (Object.prototype.hasOwnProperty.call(repliesByPost, post.id)) return;

    setReplyLoadingPostId(post.id);
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id) + "/replies", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== replyRequestRef.current) return;
      if (!response.ok) {
        setReplyError(typeof payload.error === "string" ? payload.error : "We couldn't load replies. Please try again.");
        return;
      }
      setRepliesByPost((current) => ({
        ...current,
        [post.id]: Array.isArray(payload.replies) ? payload.replies as CommunityReply[] : [],
      }));
      setReplyHasMoreByPost((current) => ({ ...current, [post.id]: payload.hasMore === true }));
      setReplyCursorByPost((current) => ({ ...current, [post.id]: typeof payload.nextCursor === "string" ? payload.nextCursor : null }));
    } catch {
      if (requestId === replyRequestRef.current) setReplyError("We couldn't load replies. Check your connection and try again.");
    } finally {
      if (requestId === replyRequestRef.current) setReplyLoadingPostId(null);
    }
  }

  async function loadOlderReplies(post: CommunityPost) {
    const cursor = replyCursorByPost[post.id];
    if (!cursor || !replyHasMoreByPost[post.id] || replyLoadingOlderPostId) return;
    setReplyLoadingOlderPostId(post.id);
    setReplyError("");
    try {
      const response = await fetch("/api/posts/" + encodeURIComponent(post.id) + "/replies?before=" + encodeURIComponent(cursor), { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Older replies couldn't be loaded.");
      const older = Array.isArray(payload.replies) ? payload.replies as CommunityReply[] : [];
      setRepliesByPost((current) => {
        const existing = current[post.id] || [];
        const ids = new Set(existing.map((reply) => reply.id));
        return { ...current, [post.id]: [...older.filter((reply) => !ids.has(reply.id)), ...existing] };
      });
      setReplyHasMoreByPost((current) => ({ ...current, [post.id]: payload.hasMore === true }));
      setReplyCursorByPost((current) => ({ ...current, [post.id]: typeof payload.nextCursor === "string" ? payload.nextCursor : null }));
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : "Older replies couldn't be loaded.");
    } finally { setReplyLoadingOlderPostId(null); }
  }

  async function handleReplySubmit(
    event: FormEvent<HTMLFormElement>,
    post: CommunityPost,
  ) {
    event.preventDefault();
    if (replyBusyPostId) return;

    if (!sessionUser) {
      setAuthMode("login");
      setAuthError("");
      setAuthModalOpen(true);
      return;
    }
    if (authConfigured !== true) {
      setReplyError("Community storage is not connected yet. Configure MongoDB before replying.");
      return;
    }
    if (!selectedPlace || selectedPlace.id !== post.placeKey) {
      setReplyError("Open this post from its place community before replying.");
      return;
    }

    const body = replyBody.trim();
    if (body.length < 2 || body.length > 300) {
      setReplyError("A reply must contain 2–300 characters.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setReplyError("This browser doesn't support location checks.");
      return;
    }

    setReplyBusyPostId(post.id);
    setReplyError("");
    showNotice("Checking your location before replying…");

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
        );
      });

      const response = await fetch(
        `/api/posts/${encodeURIComponent(post.id)}/replies`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            location: {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            },
          }),
        },
      );
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.reply) {
        if (response.status === 401) {
          setSessionUser(null);
          setAuthMode("login");
          setAuthError("");
          setAuthModalOpen(true);
        }
        setReplyError(
          typeof payload.error === "string"
            ? payload.error
            : "We couldn't publish your reply. Please try again.",
        );
        return;
      }

      const reply = payload.reply as CommunityReply;
      setRepliesByPost((current) => {
        const existing = current[post.id] || [];
        if (existing.some((item) => item.id === reply.id)) return current;
        return { ...current, [post.id]: [...existing, reply] };
      });
      setCommunityPosts((current) => current.map((item) =>
        item.id === post.id
          ? { ...item, replyCount: (item.replyCount || 0) + 1 }
          : item
      ));
      setReplyBody("");
      showNotice("Your reply is now part of the conversation.");
    } catch (error) {
      const locationError = error as GeolocationPositionError;
      if (locationError?.code === 1) {
        setReplyError("Location permission was denied. Allow location access to reply here.");
      } else if (locationError?.code === 3) {
        setReplyError("The location check timed out. Try again where your GPS signal is clearer.");
      } else {
        setReplyError("We couldn't verify your location or reach the server. Please try again.");
      }
    } finally {
      setReplyBusyPostId(null);
    }
  }

  function handlePostImagesChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const incoming = Array.from(input.files ?? []);
    input.value = "";
    if (!incoming.length) return;
    const available = 3 - selectedPostImages.length;
    if (available <= 0) {
      setPostError("You can attach up to three photos to a post.");
      return;
    }
    const valid: File[] = [];
    for (const file of incoming) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPostError("Choose JPEG, PNG, or WebP photos only.");
        continue;
      }
      if (file.size > 2_500_000) {
        setPostError("Each photo must be smaller than 2.5 MB.");
        continue;
      }
      valid.push(file);
    }
    const accepted = valid.slice(0, available).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    if (valid.length > available) setPostError("Only three photos can be attached to one post.");
    const next = [...selectedPostImages, ...accepted];
    selectedPostImagesRef.current = next;
    setSelectedPostImages(next);
  }

  function removePostImage(index: number) {
    const target = selectedPostImages[index];
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = selectedPostImages.filter((_, itemIndex) => itemIndex !== index);
    selectedPostImagesRef.current = next;
    setSelectedPostImages(next);
  }

  async function uploadPostImages(): Promise<string[]> {
    const imageIds: string[] = [];
    for (const selected of selectedPostImages) {
      const form = new FormData();
      form.append("file", selected.file);
      const response = await fetch("/api/uploads", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.image || typeof payload.image.id !== "string") {
        throw new Error(typeof payload.error === "string" ? payload.error : "An image could not be uploaded. Try a smaller photo.");
      }
      imageIds.push(payload.image.id);
    }
    return imageIds;
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
      setPostError("Choose a named street or mapped place before posting to LIVE HERE.");
      return;
    }
    if (authConfigured !== true) {
      setPostError("Community storage is not connected yet. Configure MongoDB before posting.");
      return;
    }
    const body = postBody.trim();
    if (body.length < 2 || body.length > 500) {
      setPostError("A post must contain 2–500 characters.");
      return;
    }
    const isRemoteQuestion = postType === "question" && askFromElsewhere;
    if (!isRemoteQuestion && !("geolocation" in navigator)) {
      setPostError("This browser doesn't support location checks. Select Question and enable Ask Locals to enquire without a location check.");
      return;
    }

    setPostBusy(true);
    setPostError("");
    showNotice(isRemoteQuestion ? "Sending your question to this place's community…" : "Checking your location…");

    try {
      let position: GeolocationPosition | null = null;
      if (!isRemoteQuestion) {
        position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
          );
        });
      }

      showNotice(selectedPostImages.length ? "Uploading your photos…" : isRemoteQuestion ? "Sending your question to this place's community…" : "Publishing your post…");
      const imageIds = await uploadPostImages();
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          type: postType,
          isRemoteQuestion,
          businessIds: taggedBusinessIds,
          imageIds,
          place: {
            placeKey: selectedPlace.id,
            name: selectedPlace.name,
            displayName: selectedPlace.displayName,
            kind: selectedPlace.kind,
            coordinates: selectedPlace.coordinates,
          },
          location: position ? {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          } : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.post) {
        if (response.status === 401) {
          setSessionUser(null);
          setAuthMode("login");
          setAuthModalOpen(true);
        }
        setPostError(
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
      setAskFromElsewhere(false);
      setTaggedBusinessIds([]);
      selectedPostImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      selectedPostImagesRef.current = [];
      setSelectedPostImages([]);
      setCommunityTotalCount((count) => count + 1);
      setCommunityPosts((current) => current.slice(0, 30));
      showNotice(isRemoteQuestion
        ? "Your question is now posted for local people to answer."
        : "Your contribution is now in this place's community.");
    } catch (error) {
      const locationError = error as GeolocationPositionError;
      if (!isRemoteQuestion && locationError?.code === 1) {
        setPostError("Location permission was denied. Use Ask Locals on a question to enquire without sharing your location.");
      } else if (!isRemoteQuestion && locationError?.code === 3) {
        setPostError("The location check timed out. Try again where your GPS signal is clearer, or use Ask Locals for a question.");
      } else if (error instanceof Error && error.message) {
        setPostError(error.message);
      } else if (isRemoteQuestion) {
        setPostError("We couldn't publish your question. Please check your connection and try again.");
      } else {
        setPostError("We couldn't verify your location or reach the server. Please try again.");
      }
    } finally {
      setPostBusy(false);
    }
  }

  useEffect(() => () => {
    selectedPostImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
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
      setReplyThreadPostId(null);
      setReplyBody("");
      setReplyError("");
      setActiveNav("explore");
      setSavedViewOpen(false);
      setCommunitySection("conversations");
      setCommunityConversationOnly(false);
      setPinnedConversation(null);
      setTaggedBusinessIds([]);
      setMobilePanelOpen(true);
      setMobilePanelExpanded(false);
      setSearchOpen(false);
      const url = new URL(window.location.href);
      url.searchParams.set("place", place.id);
      url.searchParams.delete("post");
      url.searchParams.delete("view");
      window.history.pushState({ theWorldPlace: place.id }, "", url.pathname + url.search + url.hash);
      mapRef.current?.flyTo(place.coordinates, place.zoom);
      mapRef.current?.setMarker(place.coordinates);
    },
    [],
  );

  const restoreLocationFromUrl = useCallback(async (clearWhenMissing = false) => {
    const requestId = ++deepLinkRequestRef.current;
    const params = new URLSearchParams(window.location.search);
    const placeKey = params.get("place") || "";
    const postId = params.get("post") || "";
    const conversationOnly = params.get("view") === "conversation" && Boolean(postId);
    if (!placeKey && !postId) {
      if (clearWhenMissing) {
        setSelectedPlace(null);
        setPinnedConversation(null);
        setCommunityConversationOnly(false);
        setReplyThreadPostId(null);
        setMobilePanelOpen(false);
        setMobilePanelExpanded(false);
      }
      return;
    }
    if (postId && !/^[a-f\d]{24}$/i.test(postId)) {
      showNotice("That conversation link is invalid.");
      return;
    }
    try {
      let place: SelectedPlace | null = null;
      let post: CommunityPost | null = null;
      if (postId) {
        const response = await fetch("/api/posts/" + encodeURIComponent(postId), { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.post) throw new Error(typeof payload.error === "string" ? payload.error : "That conversation could not be opened.");
        post = payload.post as CommunityPost;
        const raw = payload.place as Record<string, unknown> | undefined;
        if (raw && Array.isArray(raw.coordinates) && raw.coordinates.length === 2 &&
            typeof raw.coordinates[0] === "number" && typeof raw.coordinates[1] === "number") {
          place = {
            id: String(raw.id ?? post.placeKey),
            name: String(raw.name ?? post.placeName),
            subtitle: String(raw.subtitle ?? ""),
            displayName: String(raw.displayName ?? post.placeName),
            kind: String(raw.kind ?? "Mapped place"),
            coordinates: [raw.coordinates[0], raw.coordinates[1]],
            zoom: /city|town|municipality/i.test(String(raw.kind ?? "")) ? 10 : 15,
          };
        }
      }
      if (!place && /^(node|way|relation)-[1-9]\d{0,17}$/.test(placeKey)) {
        const response = await fetch("/api/places/by-id?placeKey=" + encodeURIComponent(placeKey), { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.place) throw new Error(typeof payload.error === "string" ? payload.error : "That mapped place could not be opened.");
        const raw = payload.place as Record<string, unknown>;
        if (Array.isArray(raw.coordinates) && raw.coordinates.length === 2 &&
            typeof raw.coordinates[0] === "number" && typeof raw.coordinates[1] === "number") {
          place = {
            id: String(raw.id ?? placeKey), name: String(raw.name ?? "Mapped place"),
            subtitle: String(raw.subtitle ?? ""), displayName: String(raw.displayName ?? raw.name ?? "Mapped place"),
            kind: String(raw.kind ?? "Mapped place"),
            coordinates: [raw.coordinates[0], raw.coordinates[1]],
            zoom: typeof raw.zoom === "number" ? raw.zoom : 15,
          };
        }
      }
      if (requestId !== deepLinkRequestRef.current) return;
      if (!place) throw new Error("The place link doesn't identify a valid mapped community.");
      setSelectedPlace(place);
      setActiveNav("explore");
      setSavedViewOpen(false);
      setCommunitySection("conversations");
      setCommunityConversationOnly(conversationOnly);
      setMobilePanelOpen(true);
      setMobilePanelExpanded(conversationOnly);
      setReplyThreadPostId(null);
      setPinnedConversation(post);
      mapRef.current?.flyTo(place.coordinates, place.zoom);
      mapRef.current?.setMarker(place.coordinates);
      if (post) {
        window.setTimeout(() => { if (requestId === deepLinkRequestRef.current) void toggleReplyThread(post as CommunityPost); }, 0);
      }
    } catch (error) {
      if (requestId === deepLinkRequestRef.current) showNotice(error instanceof Error ? error.message : "This place link could not be opened.");
    }
  }, [showNotice]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("place") || params.has("post")) void restoreLocationFromUrl(false);
    const onPopState = () => { void restoreLocationFromUrl(true); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restoreLocationFromUrl]);

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

  async function chooseQuickPlace(place: (typeof QUICK_PLACES)[number]) {
    setSearching(true);
    setSearchError("");
    try {
      const results = await searchPlaces(place.name + ", " + place.subtitle);
      const exact = results.find((result) => getPlaceTitle(result).toLocaleLowerCase() === place.name.toLocaleLowerCase());
      const result = exact ?? results[0];
      if (!result) {
        showNotice("We couldn't find a mapped listing for " + place.name + ". Search for the place instead.");
        return;
      }
      chooseSearchResult(result);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "That place could not be resolved right now.");
    } finally {
      setSearching(false);
    }
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

  async function toggleFollowPlace() {
    if (!selectedPlace) return;
    if (!placeSupportsLiveHere) {
      showNotice("Choose a named mapped place to follow its community.");
      return;
    }
    if (!sessionUser) {
      setAuthMode("login");
      setAuthModalOpen(true);
      showNotice("Sign in to follow communities across visits.");
      return;
    }
    if (followActionBusy) return;

    const alreadyFollowing = followedPlaces.some((place) => place.placeKey === selectedPlace.id);
    setFollowActionBusy(true);
    setFollowedPlacesError("");
    try {
      const response = await fetch("/api/followed-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: alreadyFollowing ? "unfollow" : "follow",
          placeKey: selectedPlace.id,
          name: selectedPlace.name,
          displayName: selectedPlace.displayName,
          subtitle: selectedPlace.subtitle,
          kind: selectedPlace.kind,
          coordinates: selectedPlace.coordinates,
          zoom: selectedPlace.zoom,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "We couldn't update your followed places.");
      if (alreadyFollowing) {
        setFollowedPlaces((current) => current.filter((place) => place.placeKey !== selectedPlace.id));
        showNotice("You stopped following this community.");
      } else {
        const followed: FollowedPlace = {
          placeKey: selectedPlace.id,
          name: selectedPlace.name,
          displayName: selectedPlace.displayName,
          subtitle: selectedPlace.subtitle,
          kind: selectedPlace.kind,
          coordinates: selectedPlace.coordinates,
          zoom: selectedPlace.zoom,
          followedAt: new Date().toISOString(),
        };
        setFollowedPlaces((current) => current.some((place) => place.placeKey === followed.placeKey)
          ? current
          : [followed, ...current]);
        showNotice("Community added to your followed places.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "We couldn't update your followed places.";
      setFollowedPlacesError(message);
      showNotice(message);
    } finally {
      setFollowActionBusy(false);
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

  function toggleMapProvider() {
    if (mapProvider === "globe") {
      if (!GOOGLE_3D_CONFIGURED) {
        showNotice("To enable Google 3D, add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to the Vercel Preview environment, then redeploy.");
        return;
      }
      setProjection("globe");
      setMapProvider("google-3d");
      showNotice("Google 3D is loading. Detailed 3D imagery varies by location.");
      return;
    }
    setMapProvider("globe");
    setProjection("globe");
    showNotice("Returned to the world globe.");
  }

  const isCurrentPlaceFollowed = useMemo(
    () => selectedPlace && followedPlaces.some((place) => place.placeKey === selectedPlace.id),
    [followedPlaces, selectedPlace],
  );

  const isCurrentPlaceSaved = useMemo(
    () => selectedPlace && savedPlaces.some((place) => place.id === selectedPlace.id),
    [savedPlaces, selectedPlace],
  );
  const displayedCommunityPosts = communityConversationOnly && pinnedConversation
    ? [pinnedConversation]
    : communityPosts;

  return (
    <main className={["world-shell", selectedPlace && mobilePanelExpanded ? "community-fullscreen-open" : ""].filter(Boolean).join(" ")}>
      <div className="map-background" aria-hidden="true">
        {mapProvider === "google-3d" ? (
          <Google3DMap
            key="google-3d"
            ref={mapRef}
            initialCoordinates={selectedPlace?.coordinates ?? QUICK_PLACES[0].coordinates}
            initialZoom={selectedPlace?.zoom ?? QUICK_PLACES[0].zoom}
            onStatusChange={setMapStatus}
            onMapClick={(coordinates) => { void handleMapClick(coordinates); }}
          />
        ) : (
          <GlobeMap
            key="openfreemap-globe"
            ref={mapRef}
            onStatusChange={setMapStatus}
            onMapClick={(coordinates) => { void handleMapClick(coordinates); }}
          />
        )}
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
            <small>Places and local conversations</small>
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
              placeholder="Search a city, street or landmark"
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
          <span className="preview-label">Preview</span>
          {sessionUser && (
            <div className="notification-shell">
              <button
                className="avatar-mark notification-button"
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={notificationsUnread ? `Notifications, ${notificationsUnread} unread` : "Notifications"}
                aria-expanded={notificationsOpen}
                title="Notifications"
              >
                <Bell size={17} />
                {notificationsUnread > 0 && <span className="notification-count">{notificationsUnread > 99 ? "99+" : notificationsUnread}</span>}
              </button>
              {notificationsOpen && (
                <section className="notification-popover" aria-label="Notifications">
                  <div className="notification-popover-heading">
                    <div><strong>Notifications</strong><small>{notificationsUnread ? `${notificationsUnread} unread` : "You're all caught up"}</small></div>
                    {notificationsUnread > 0 && <button type="button" onClick={() => void markAllNotificationsRead()}>Mark all read</button>}
                  </div>
                  {notificationsBusy && notifications.length === 0 ? (
                    <div className="notification-empty">Loading notifications…</div>
                  ) : notificationsError ? (
                    <div className="notification-empty" role="alert">{notificationsError}</div>
                  ) : notifications.length === 0 ? (
                    <div className="notification-empty">Likes and replies to your posts will appear here.</div>
                  ) : (
                    <div className="notification-list">
                      {notifications.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={item.readAt ? "notification-row" : "notification-row unread"}
                          onClick={() => void handleNotificationRead(item)}
                        >
                          <span className="notification-row-icon">{item.type === "reply" || item.type === "new_post" ? <MessageCircle size={15} /> : <Heart size={15} />}</span>
                          <span className="notification-row-copy">
                            <strong>{item.actor.displayName}</strong>
                            <span>{item.type === "reply" ? "replied to your conversation" : item.type === "new_post" ? "posted in a community you follow" : "liked your post"}</span>
                            <small>{item.placeName} · {formatPostTime(item.createdAt)}</small>
                          </span>
                          {!item.readAt && <span className="notification-unread-dot" />}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
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
        <div className="panel-kicker">EXPLORE THE MAP</div>
        <h1>Find a place.<br /><em>Meet its people.</em></h1>
        <p className="intro-copy">
          Browse the map, open a place, and see what people there are sharing.
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
            <span>Nearby</span>
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
            <span className="eyebrow">QUICK PICKS</span>
            <h2>Places to start</h2>
          </div>
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
                <MapPin size={15} aria-hidden="true" />
              </span>
              <span className="quick-place-copy">
                <strong>{place.name}</strong>
                <small>{place.subtitle}</small>
              </span>
              <ArrowUpRight size={15} className="quick-arrow" />
            </button>
          ))}
        </div>

        <div className="place-note">
          <span className="place-note-icon"><MessageCircle size={16} /></span>
          <div>
            <strong>Conversations stay local</strong>
            <p>Posts belong to a mapped place. Sharing one asks you to check in nearby.</p>
          </div>
        </div>

        <div className="panel-footnote">
          <ShieldCheck size={14} />
          <span>Your device coordinates are never shown to other people.</span>
        </div>
      </aside>

      <section
        ref={placePanelRef}
        id="selected-place-panel"
        className={[
          "right-panel",
          "glass-panel",
          selectedPlace || savedViewOpen || mobilePanelOpen ? "right-panel-open" : "",
          mobilePanelOpen ? "mobile-panel-open" : "",
          selectedPlace && mobilePanelExpanded ? "mobile-panel-fullscreen" : "",
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
            <section className="followed-activity-section">
              <div className="followed-activity-heading">
                <div><span className="eyebrow">YOUR FOLLOWING</span><h3>Community activity</h3></div>
                <button type="button" onClick={() => setFollowedActivityRefresh((version) => version + 1)} disabled={followedActivityBusy} aria-label="Refresh followed-community activity"><RefreshCw size={14} /></button>
              </div>
              {followedActivityError ? (
                <div className="community-error-card"><ShieldCheck size={15} /><div><p>{followedActivityError}</p><button type="button" className="community-inline-retry" onClick={() => setFollowedActivityRefresh((version) => version + 1)}>Retry <RefreshCw size={12} /></button></div></div>
              ) : followedActivityBusy ? (
                <div className="community-loading-card"><span className="mini-spinner" /><span>Loading followed communities…</span></div>
              ) : followedActivity.length === 0 ? (
                <div className="community-empty-card"><strong>No new community activity</strong><p>Follow a mapped place to bring its latest conversations into this space.</p></div>
              ) : (
                <div className="followed-activity-list">
                  {followedActivity.map((item) => (
                    <button type="button" className="followed-activity-row" key={item.id} onClick={() => {
                      const params = new URLSearchParams({ place: item.placeKey, post: item.id, view: "conversation" });
                      window.location.href = "/?" + params.toString();
                    }}>
                      <span className="followed-activity-icon">{item.isRemoteQuestion ? <Globe size={15} /> : <MessageCircle size={15} />}</span>
                      <span className="followed-activity-copy"><strong>{item.placeName}</strong><small>@{item.author.username} · {formatPostTime(item.createdAt)}</small><span>{item.body}</span><small>{item.replyCount} {item.replyCount === 1 ? "reply" : "replies"} · Open conversation</small></span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : selectedPlace ? (
          <div className="place-panel-content">
            <div className="place-panel-header">
              <div>
                <span className="eyebrow">PLACE DETAILS</span>
                <div className="place-type-line">{selectedPlace.kind}</div>
              </div>
              <div className="place-panel-header-actions">
                <button
                  type="button"
                  className="place-view-toggle"
                  onClick={() => {
                    if (mobilePanelExpanded) {
                      placePanelRef.current?.scrollTo({ top: 0, behavior: "auto" });
                      setMobilePanelExpanded(false);
                      if (communityConversationOnly) {
                        setCommunityConversationOnly(false);
                        setPinnedConversation(null);
                        setReplyThreadPostId(null);
                        const url = new URL(window.location.href);
                        url.searchParams.delete("post");
                        url.searchParams.delete("view");
                        window.history.pushState({ theWorldPlace: selectedPlace?.id }, "", url.pathname + url.search + url.hash);
                      }
                    } else {
                      setMobilePanelExpanded(true);
                    }
                  }}
                  aria-expanded={mobilePanelExpanded}
                  aria-controls="selected-place-panel"
                  aria-label={mobilePanelExpanded ? "Minimize community and show map" : "Expand community full screen"}
                  title={mobilePanelExpanded ? "Show map" : "Open full-screen community"}
                >
                  {mobilePanelExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                  <span>{mobilePanelExpanded ? "Show map" : "Full view"}</span>
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => {
                    setSelectedPlace(null);
                    setMobilePanelOpen(false);
                    setMobilePanelExpanded(false);
                  }}
                  aria-label="Close place details"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <h2 className="selected-place-title">{selectedPlace.name}</h2>
            <p className="selected-place-subtitle">{selectedPlace.subtitle}</p>

            <div className="selected-place-address">
              <MapPin size={16} />
              <span>{selectedPlace.displayName}</span>
            </div>
            {selectedPlace.displayName.split(",").filter(Boolean).length > 2 && (
              <button type="button" className="broader-area-link" onClick={() => void exploreBroaderArea()}>
                Explore broader area <ArrowUpRight size={13} />
              </button>
            )}

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
                onClick={() => document.getElementById("community-composer")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
              >
                <MessageCircle size={16} /> Add a post
              </button>
              <button
                type="button"
                className={isCurrentPlaceFollowed ? "secondary-action follow-place-active" : "secondary-action"}
                onClick={() => void toggleFollowPlace()}
                disabled={!placeSupportsLiveHere || followActionBusy}
                title={!placeSupportsLiveHere ? "Choose a named mapped place to follow its community." : undefined}
              >
                {followActionBusy ? <span className="mini-spinner" /> : isCurrentPlaceFollowed ? <Check size={16} /> : <Compass size={16} />}
                {followActionBusy ? "Updating…" : isCurrentPlaceFollowed ? "Following community" : "Follow community"}
              </button>
            </div>
            {!placeSupportsLiveHere && (
              <p className="follow-place-hint">Following is available for named mapped places. Choose a real street, venue or neighbourhood.</p>
            )}

            {!communityConversationOnly && <>
            <div className="place-card-divider" />
            <div className="place-community-tabs" role="tablist" aria-label="Place sections">
              <button type="button" role="tab" aria-selected={communitySection === "conversations"} className={communitySection === "conversations" ? "active" : ""} onClick={() => setCommunitySection("conversations")}>
                <MessageCircle size={15} /> Conversations <span>{communityTotalCount}</span>
              </button>
              <button type="button" role="tab" aria-selected={communitySection === "businesses"} className={communitySection === "businesses" ? "active" : ""} onClick={() => setCommunitySection("businesses")}>
                <Building2 size={15} /> Businesses <span>{availableBusinessTags.length || ""}</span>
              </button>
              <button type="button" role="tab" aria-selected={communitySection === "nearby"} className={communitySection === "nearby" ? "active" : ""} onClick={() => setCommunitySection("nearby")}>
                <Compass size={15} /> Nearby places
              </button>
            </div>
            </>}
            {communityConversationOnly ? (
              <div className="community-single-conversation-back">
                <button type="button" onClick={() => {
                  setCommunityConversationOnly(false);
                  setPinnedConversation(null);
                  setReplyThreadPostId(null);
                  setMobilePanelExpanded(false);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("post");
                  url.searchParams.delete("view");
                  window.history.pushState({ theWorldPlace: selectedPlace.id }, "", url.pathname + url.search + url.hash);
                }}><ArrowLeft size={14} /> All conversations in {selectedPlace.name}</button>
              </div>
            ) : null}
            {communitySection === "businesses" ? (
              <BusinessDirectory
                place={{ id: selectedPlace.id, name: selectedPlace.name, displayName: selectedPlace.displayName, coordinates: selectedPlace.coordinates }}
                sessionUser={sessionUser ? { id: sessionUser.id, username: sessionUser.username, displayName: sessionUser.displayName } : null}
                authConfigured={authConfigured}
                onSignIn={() => { setAuthMode("login"); setAuthError(""); setAuthModalOpen(true); }}
                onBusinessesChange={handleBusinessTagsChange}
              />
            ) : communitySection === "nearby" ? (
              <NearbyCommunities
                place={{ id: selectedPlace.id, name: selectedPlace.name, displayName: selectedPlace.displayName, kind: selectedPlace.kind, coordinates: selectedPlace.coordinates }}
                onSelect={(place) => selectPlace(place)}
              />
            ) : (
              <div className="community-feed-area">
                <div className="community-feed-toolbar">
                  {!communityConversationOnly && <div className="community-feed-filter-row" role="group" aria-label="Filter conversations">
                    <button type="button" className={communityFilter === "all" ? "active" : ""} onClick={() => setCommunityFilter("all")}>All</button>
                    <button type="button" className={communityFilter === "question" ? "active" : ""} onClick={() => setCommunityFilter("question")}>Questions</button>
                    <button type="button" className={communityFilter === "unanswered" ? "active" : ""} onClick={() => setCommunityFilter("unanswered")}>Unanswered</button>
                    <button type="button" className={communityFilter === "discovery" ? "active" : ""} onClick={() => setCommunityFilter("discovery")}>Discoveries</button>
                    <button type="button" className={communityFilter === "update" ? "active" : ""} onClick={() => setCommunityFilter("update")}>Updates</button>
                  </div>}
                  <div className="community-feed-toolbar-bottom">
                    <span>{communityConversationOnly ? "One conversation" : `${communityTotalCount} ${communityTotalCount === 1 ? "conversation" : "conversations"}`}</span>
                    <button type="button" onClick={() => setCommunityRefreshVersion((version) => version + 1)} disabled={communityLoading} aria-label="Refresh conversations">
                      <RefreshCw size={14} className={communityLoading ? "community-refresh-spinning" : ""} /> Refresh
                    </button>
                  </div>
                </div>
            <div className="community-preview-heading">
              <div>
                <span className="eyebrow">LOCAL COMMUNITY</span>
                <h3>{communityConversationOnly ? "Full conversation" : /city|town|municipality/i.test(selectedPlace.kind) ? "City conversations" : displayedCommunityPosts.length > 0 ? "Recent conversations" : "Start the conversation"}</h3>
              </div>
              <span className="community-count">{communityTotalCount}</span>
            </div>

            {!placeSupportsLiveHere ? (
              <div className="community-status-card">
                <p>Choose a named street, venue or neighbourhood to open its community. A map point without a named feature can be explored, but cannot host posts.</p>
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
                  <button type="button" className="community-inline-retry" onClick={() => setCommunityRefreshVersion((version) => version + 1)}>Retry <RefreshCw size={12} /></button>
                </div>
              </div>
            ) : displayedCommunityPosts.length === 0 ? (
              <div className="community-empty-card">
                <strong>No conversations yet</strong>
                <p>Be the first to share something useful from this place.</p>
              </div>
            ) : (
              <div className="community-post-list">
                {displayedCommunityPosts.map((post) => (
                  <article className="community-post-card" key={post.id}>
                    <div className="community-post-top">
                      <span className="community-post-avatar">{(post.author.displayName || post.author.username || "W").slice(0, 1).toUpperCase()}</span>
                      <div className="community-post-author">
                        <Link className="profile-name-link" href={`/u/${encodeURIComponent(post.author.username)}`}><strong>{post.author.displayName || post.author.username}</strong></Link>
                        <small>@{post.author.username} · {formatPostTime(post.createdAt)}</small>
                      </div>
                      <div className="community-post-labels">
                        {post.isRemoteQuestion ? (
                          <span className="remote-question-badge"><Globe size={11} /> Asking from elsewhere</span>
                        ) : (
                          <span className={`community-post-type type-${post.type}`}>{post.type}</span>
                        )}
                      </div>
                    </div>
                    {editingPostId === post.id ? (
                      <form className="community-edit-form" onSubmit={(event) => void saveEditedPost(event, post)}>
                        <textarea value={editingPostBody} onChange={(event) => setEditingPostBody(event.target.value.slice(0, 500))} rows={4} maxLength={500} required aria-label="Edit your post" />
                        <div><span>{editingPostBody.length}/500</span><button type="submit" disabled={postBusy || editingPostBody.trim().length < 2}>{postBusy ? "Saving…" : "Save changes"}</button><button type="button" className="community-quiet-button" onClick={() => { setEditingPostId(null); setEditingPostBody(""); }}>Cancel</button></div>
                      </form>
                    ) : (
                      <>
                        <p className="community-post-body">{post.body}{post.editedAt && <small className="community-edited-label"> · edited</small>}</p>
                        {post.images && post.images.length > 0 && (
                          <div className="community-post-images">
                            {post.images.map((image, index) => (
                              <a href={image.url} key={image.id} target="_blank" rel="noreferrer noopener" aria-label={`Open photo ${index + 1} in full size`}>
                                <Image src={image.url} alt={`Photo shared by @${post.author.username}`} width={960} height={720} unoptimized />
                              </a>
                            ))}
                          </div>
                        )}
                        {post.taggedBusinesses?.length > 0 && (
                          <div className="tagged-business-list" aria-label="Tagged businesses">
                            {post.taggedBusinesses.map((business) => <button key={business.businessId} type="button" onClick={() => setCommunitySection("businesses")}><Building2 size={12} /> {business.name}</button>)}
                          </div>
                        )}
                      </>
                    )}
                    <div className="community-post-footer">
                      <span><MapPin size={12} /> {post.placeName || selectedPlace?.name}</span>
                      {post.presenceVerifiedAt && <span><ShieldCheck size={12} /> Presence checked</span>}
                    </div>

                    <div className="post-reaction-bar">
                      <button
                        type="button"
                        className={post.isLiked ? "post-reaction-button is-active" : "post-reaction-button"}
                        onClick={() => void handlePostAction(post, "like")}
                        aria-pressed={post.isLiked}
                        aria-label={post.isLiked ? "Unlike post" : "Like post"}
                      >
                        <Heart size={15} fill={post.isLiked ? "currentColor" : "none"} />
                        <span>{post.likesCount || 0}</span>
                        <span>{post.likesCount === 1 ? "like" : "likes"}</span>
                      </button>
                      <button type="button" className="post-reaction-button" onClick={() => void sharePost(post)} aria-label="Share conversation" title="Share conversation">
                        <Share2 size={14} /><span>Share</span>
                      </button>
                      {post.author.username === sessionUser?.username ? (
                        <>
                          <button type="button" className="post-report-trigger" onClick={() => { setEditingPostId(post.id); setEditingPostBody(post.body); setPostError(""); }} aria-label="Edit your post" title="Edit post">
                            <Pencil size={14} /><span>Edit</span>
                          </button>
                          <button type="button" className="post-report-trigger" onClick={() => void deletePost(post)} disabled={postBusy} aria-label="Delete your post" title="Delete post">
                            <Trash2 size={14} /><span>Delete</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="post-report-trigger"
                          onClick={() => openReport({
                            targetType: "post",
                            targetId: post.id,
                            authorUsername: post.author.username,
                            body: post.body,
                            placeName: post.placeName || selectedPlace?.name || "this place",
                          })}
                          aria-label={`Report post by @${post.author.username}`}
                          title="Report post"
                        >
                          <Flag size={14} />
                          <span>Report</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className={post.isBookmarked ? "post-reaction-button is-active" : "post-reaction-button"}
                        onClick={() => void handlePostAction(post, "bookmark")}
                        aria-pressed={post.isBookmarked}
                        aria-label={post.isBookmarked ? "Remove saved post" : "Save post"}
                      >
                        <Bookmark size={15} fill={post.isBookmarked ? "currentColor" : "none"} />
                        <span>{post.isBookmarked ? "Saved" : "Save"}</span>
                      </button>
                    </div>

                    <button
                      className={replyThreadPostId === post.id ? "reply-thread-toggle is-open" : "reply-thread-toggle"}
                      type="button"
                      onClick={() => { void toggleReplyThread(post); }}
                      aria-expanded={replyThreadPostId === post.id}
                      aria-controls={`reply-thread-${post.id}`}
                    >
                      <MessageCircle size={14} />
                      <span>{post.replyCount || 0} {post.replyCount === 1 ? "reply" : "replies"}</span>
                      <span className="reply-thread-action">{replyThreadPostId === post.id ? "Hide conversation" : "Join conversation"}</span>
                      <ChevronRight size={15} className="reply-thread-chevron" />
                    </button>

                    {replyThreadPostId === post.id && (
                      <div className="reply-thread" id={`reply-thread-${post.id}`}>
                        {replyLoadingPostId === post.id ? (
                          <div className="reply-thread-loading">
                            <span className="mini-spinner" /> Loading replies…
                          </div>
                        ) : replyError && !Object.prototype.hasOwnProperty.call(repliesByPost, post.id) ? (
                          <div className="reply-thread-error" role="alert">{replyError}</div>
                        ) : (
                          <>
                            {replyHasMoreByPost[post.id] && (
                              <button type="button" className="community-load-more reply-load-older" onClick={() => void loadOlderReplies(post)} disabled={replyLoadingOlderPostId === post.id}>
                                {replyLoadingOlderPostId === post.id ? <span className="mini-spinner" /> : <ChevronDown size={14} />}
                                {replyLoadingOlderPostId === post.id ? "Loading older replies…" : "Load older replies"}
                              </button>
                            )}
                            {(repliesByPost[post.id] || []).length === 0 ? (
                              <div className="reply-thread-empty">
                                <strong>No replies yet.</strong>
                                <span>Be the first to add something useful to this conversation.</span>
                              </div>
                            ) : (
                              <div className="reply-list">
                                {(repliesByPost[post.id] || []).map((reply) => (
                                  <div className="reply-row" key={reply.id}>
                                    <span className="reply-avatar">{(reply.author.displayName || reply.author.username || "W").slice(0, 1).toUpperCase()}</span>
                                    <div className="reply-content">
                                      <div className="reply-author-line">
                                        <Link className="profile-name-link" href={`/u/${encodeURIComponent(reply.author.username)}`}><strong>{reply.author.displayName || reply.author.username}</strong></Link>
                                        <small>@{reply.author.username} · {formatPostTime(reply.createdAt)}</small>
                                      </div>
                                      {editingReplyId === reply.id ? (
                                        <form className="reply-edit-form" onSubmit={(event) => void saveEditedReply(event, post, reply)}>
                                          <textarea value={editingReplyBody} onChange={(event) => setEditingReplyBody(event.target.value.slice(0, 300))} maxLength={300} rows={3} aria-label="Edit your reply" required />
                                          <div><span>{editingReplyBody.length}/300</span><button type="submit" disabled={replyBusyPostId === post.id || editingReplyBody.trim().length < 2}>{replyBusyPostId === post.id ? "Saving…" : "Save"}</button><button type="button" className="community-quiet-button" onClick={() => { setEditingReplyId(null); setEditingReplyBody(""); }}>Cancel</button></div>
                                        </form>
                                      ) : <p>{reply.body}{reply.editedAt && <small className="community-edited-label"> · edited</small>}</p>}
                                      {reply.presenceVerifiedAt && (
                                        <span className="reply-presence"><ShieldCheck size={11} /> Local presence checked when posted</span>
                                      )}
                                    </div>
                                    {reply.author.username === sessionUser?.username && (
                                      <div className="reply-owner-actions">
                                        {editingReplyId !== reply.id && <button type="button" onClick={() => { setEditingReplyId(reply.id); setEditingReplyBody(reply.body); setReplyError(""); }} aria-label="Edit your reply"><Pencil size={12} /> Edit</button>}
                                        <button type="button" onClick={() => void deleteReply(post, reply)} disabled={replyBusyPostId === post.id} aria-label="Delete your reply"><Trash2 size={12} /> Delete</button>
                                      </div>
                                    )}
                                    {reply.author.username !== sessionUser?.username && (
                                      <button
                                        type="button"
                                        className="reply-report-button"
                                        onClick={() => openReport({
                                          targetType: "reply",
                                          targetId: reply.id,
                                          authorUsername: reply.author.username,
                                          body: reply.body,
                                          placeName: reply.placeName || post.placeName || selectedPlace?.name || "this place",
                                        })}
                                        aria-label={`Report reply by @${reply.author.username}`}
                                        title="Report reply"
                                      >
                                        <Flag size={13} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}

                            {replyError && <p className="reply-form-error" role="alert">{replyError}</p>}

                            {sessionUser ? (
                              <form className="reply-composer-form" onSubmit={(event) => { void handleReplySubmit(event, post); }}>
                                <textarea
                                  value={replyThreadPostId === post.id ? replyBody : ""}
                                  onChange={(event) => setReplyBody(event.target.value.slice(0, 300))}
                                  placeholder="Add a thoughtful reply…"
                                  maxLength={300}
                                  rows={2}
                                  aria-label="Your reply"
                                  disabled={replyBusyPostId === post.id || authConfigured !== true}
                                />
                                <div className="reply-composer-bottom">
                                  <span>{replyBody.length}/300 · Local presence required</span>
                                  <button type="submit" disabled={replyBusyPostId === post.id || replyBody.trim().length < 2 || authConfigured !== true}>
                                    {replyBusyPostId === post.id ? <span className="mini-spinner" /> : <Send size={13} />}
                                    {replyBusyPostId === post.id ? "Checking…" : "Reply"}
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div className="reply-signin-prompt">
                                <span>Sign in and be physically present to reply.</span>
                                <button type="button" onClick={() => { setAuthMode("login"); setAuthError(""); setAuthModalOpen(true); }}>
                                  <LogIn size={13} /> Sign in
                                </button>
                              </div>
                            )}

                            <div className="reply-presence-note">
                              <ShieldCheck size={12} />
                              <span>Replies are checked against the mapped place on the server. Exact coordinates are never published.</span>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}

            {!communityConversationOnly && communityHasMore && (
              <div className="community-load-more-wrap">
                <button type="button" className="community-load-more" onClick={() => void loadMoreCommunityPosts()} disabled={communityLoadingMore}>
                  {communityLoadingMore ? <span className="mini-spinner" /> : <ChevronDown size={15} />} {communityLoadingMore ? "Loading older conversations…" : "Load older conversations"}
                </button>
              </div>
            )}
            {!communityConversationOnly && <div className="post-composer-card" id="community-composer">
              <div className="post-composer-heading">
                <span className="composer-icon"><MessageCircle size={16} /></span>
                <div>
                  <strong>Add to this community</strong>
                  <small>{sessionUser ? `Posting as @${sessionUser.username}` : "Sign in to contribute to the community"}</small>
                </div>
              </div>

              {postError && <p className="post-error" role="alert">{postError}</p>}
              {sessionUser ? (
                <form className="community-post-form" onSubmit={handlePublishPost}>
                  <select
                    value={postType}
                    onChange={(event) => {
                      const nextType = event.target.value as CommunityPost["type"];
                      setPostType(nextType);
                      if (nextType !== "question") setAskFromElsewhere(false);
                    }}
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
                    placeholder={postType === "question" && askFromElsewhere
                      ? "What would you like to know about this place?"
                      : "What's worth sharing about this place?"}
                    maxLength={500}
                    rows={3}
                    aria-label={postType === "question" && askFromElsewhere ? "Your question for local people" : "Your local post"}
                    disabled={postBusy || !placeSupportsLiveHere || authConfigured !== true}
                  />
                  <div className="post-image-picker">
                    <label className="post-image-picker-button">
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePostImagesChange} disabled={postBusy || selectedPostImages.length >= 3} aria-label="Add post photos" />
                      <span><Plus size={14} /> Add photos</span>
                    </label>
                    <small>Up to 3 photos · JPEG, PNG or WebP · 2.5 MB each</small>
                  </div>
                  {selectedPostImages.length > 0 && (
                    <div className="post-image-previews">
                      {selectedPostImages.map((item, index) => (
                        <div className="post-image-preview" key={item.previewUrl}>
                          <Image src={item.previewUrl} alt={`Selected photo ${index + 1}`} width={240} height={180} unoptimized />
                          <button type="button" onClick={() => removePostImage(index)} disabled={postBusy} aria-label={`Remove photo ${index + 1}`}><X size={13} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                  {postType === "question" && (
                    <label className="remote-question-toggle">
                      <input
                        type="checkbox"
                        checked={askFromElsewhere}
                        onChange={(event) => setAskFromElsewhere(event.target.checked)}
                        disabled={postBusy || !placeSupportsLiveHere || authConfigured !== true}
                      />
                      <span className="remote-question-toggle-copy">
                        <strong><Globe size={13} /> Ask locals from elsewhere</strong>
                        <small>Ask a question about this place without a location check. Your post will carry an “Asking from elsewhere” badge so readers know you’re enquiring, not claiming to be there.</small>
                      </span>
                    </label>
                  )}
                  {availableBusinessTags.length > 0 && (
                    <fieldset className="post-business-tags">
                      <legend>Tag a verified business (optional, up to 3)</legend>
                      <div>
                        {availableBusinessTags.map((business) => (
                          <label key={business.businessId}>
                            <input type="checkbox" checked={taggedBusinessIds.includes(business.businessId)} onChange={(event) => {
                              if (event.target.checked) {
                                if (taggedBusinessIds.length >= 3) { showNotice("You can tag up to three businesses per post."); return; }
                                setTaggedBusinessIds((current) => current.includes(business.businessId) ? current : [...current, business.businessId]);
                              } else setTaggedBusinessIds((current) => current.filter((id) => id !== business.businessId));
                            }} disabled={postBusy} />
                            <span><Building2 size={12} /> {business.name}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  <div className="post-composer-bottom">
                    <span>{postBody.length}/500 · {postType === "question" && askFromElsewhere ? "No location check · Ask Locals" : "Location check required"}</span>
                    <button type="submit" disabled={postBusy || postBody.trim().length < 2 || !placeSupportsLiveHere || authConfigured !== true}>
                      {postBusy ? <span className="mini-spinner" /> : <Send size={14} />}
                      {postBusy ? (postType === "question" && askFromElsewhere ? "Sending…" : "Checking…") : (postType === "question" && askFromElsewhere ? "Ask locals" : "Post here")}
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
                {postType === "question" && askFromElsewhere ? <Globe size={13} /> : <ShieldCheck size={13} />}
                <span>{postType === "question" && askFromElsewhere
                  ? "Ask Locals questions do not request your GPS location. They’re clearly labelled so people nearby can answer based on local knowledge."
                  : "Your exact coordinates are not published. The server checks the mapped OSM geometry. Browser GPS can still be spoofed, so this remains a prototype safeguard, not security-grade proof."}</span>
              </div>
            </div>}
              </div>
            )}
          </div>
        ) : (
          <div className="welcome-panel-content">
            <span className="eyebrow">WELCOME TO THE WORLD</span>
            <h2>Where would<br />you like to go?</h2>
            <p className="welcome-copy">
              Search for a city, street or landmark. Its place panel opens beside the map.
            </p>
            <div className="welcome-instruction">
              <span className="instruction-number">01</span>
              <span><strong>Find a place</strong><small>Search above, or click a named feature on the map.</small></span>
              <Search size={17} />
            </div>
            <div className="welcome-instruction">
              <span className="instruction-number">02</span>
              <span><strong>Explore its details</strong><small>Read the address and save places you want to revisit.</small></span>
              <MapPin size={17} />
            </div>
            <div className="welcome-instruction">
              <span className="instruction-number">03</span>
              <span><strong>Join a conversation</strong><small>Posting and replying asks you to confirm you're nearby.</small></span>
              <MessageCircle size={17} />
            </div>
            <div className="welcome-tip">
              <span className="tip-icon"><ShieldCheck size={15} /></span>
              <p>You can browse without location permission. Your device location is requested only when you post or reply.</p>
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
          ? (mapProvider === "google-3d" ? "Google 3D ready" : "Map ready")
          : mapStatus === "error"
            ? "Map unavailable"
            : (mapProvider === "google-3d" ? "Loading Google 3D" : "Loading map")}
      </div>

      {mapStatus === "error" && (
        <div className="map-error-card">
          <Globe size={19} />
          <div>
            <strong>Map unavailable</strong>
            <p>{mapProvider === "google-3d"
              ? "Google Maps could not initialize. Check the API key, Maps JavaScript API access, website restrictions and billing."
              : "Check your connection, then refresh to try again."}</p>
          </div>
        </div>
      )}

      <div className="map-controls" aria-label="Map controls">
        <button type="button" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in"><Plus size={17} /></button>
        <button type="button" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out"><Minus size={17} /></button>
        <span className="map-controls-divider" />
        <button type="button" onClick={() => { mapRef.current?.resetView(); setProjection("globe"); }} aria-label={mapProvider === "google-3d" ? "Reset Google 3D view" : "Reset globe view"} title="Reset view"><RotateCcw size={16} /></button>
        {mapProvider === "globe" && (
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
        )}
        <button
          type="button"
          className="projection-button google-view-button"
          onClick={toggleMapProvider}
          aria-label={mapProvider === "google-3d" ? "Return to globe map" : "Switch to Google 3D map"}
          title={mapProvider === "google-3d"
            ? "Return to the world globe"
            : GOOGLE_3D_CONFIGURED
              ? "Open Google's photorealistic 3D map"
              : "Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Vercel Preview to enable Google 3D"}
          aria-pressed={mapProvider === "google-3d"}
        >
          {mapProvider === "google-3d" ? <Globe size={17} /> : <Building2 size={17} />}
          <span>{mapProvider === "google-3d" ? "MAP" : "G3D"}</span>
        </button>
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
                <form className="profile-form" onSubmit={(event) => void handleProfileSave(event)}>
                  <label>
                    <span>Display name</span>
                    <input
                      value={profileDisplayName}
                      onChange={(event) => setProfileDisplayName(event.target.value.slice(0, 40))}
                      maxLength={40}
                      minLength={2}
                      required
                      autoComplete="name"
                      disabled={profileBusy}
                    />
                  </label>
                  <label>
                    <span>Bio <small>{profileBio.length}/160</small></span>
                    <textarea
                      value={profileBio}
                      onChange={(event) => setProfileBio(event.target.value.slice(0, 160))}
                      maxLength={160}
                      rows={3}
                      placeholder="A little about you and the places you care about."
                      disabled={profileBusy}
                    />
                  </label>
                  {profileError && <p className="post-error" role="alert">{profileError}</p>}
                  <button className="auth-submit" type="submit" disabled={profileBusy}>
                    {profileBusy ? <span className="mini-spinner" /> : <Check size={16} />}
                    {profileBusy ? "Saving profile…" : "Save profile"}
                  </button>
                </form>
                <div className="saved-posts-section followed-places-section">
                  <button
                    type="button"
                    className="saved-posts-toggle"
                    onClick={() => setFollowedPlacesExpanded((expanded) => !expanded)}
                    aria-expanded={followedPlacesExpanded}
                  >
                    <Compass size={16} />
                    <span>Followed places{followedPlaces.length ? ` · ${followedPlaces.length}` : ""}</span>
                    <ChevronRight size={15} className={followedPlacesExpanded ? "saved-posts-chevron open" : "saved-posts-chevron"} />
                  </button>
                  {followedPlacesExpanded && (
                    <div className="saved-posts-content">
                      {followedPlacesBusy ? (
                        <div className="notification-empty">Loading followed places…</div>
                      ) : followedPlacesError ? (
                        <div className="notification-empty" role="alert">{followedPlacesError}</div>
                      ) : followedPlaces.length === 0 ? (
                        <div className="notification-empty">Follow a named place while exploring and it will stay here across visits.</div>
                      ) : followedPlaces.map((place) => (
                        <button
                          key={place.placeKey}
                          type="button"
                          className="saved-post-row"
                          onClick={() => {
                            selectPlace({
                              id: place.placeKey,
                              name: place.name,
                              subtitle: place.subtitle,
                              displayName: place.displayName,
                              kind: place.kind,
                              coordinates: place.coordinates,
                              zoom: place.zoom,
                            });
                            setAuthModalOpen(false);
                            setFollowedPlacesExpanded(false);
                            showNotice(`Opened ${place.name}.`);
                          }}
                        >
                          <span className="saved-place-icon"><MapPin size={15} /></span>
                          <span className="saved-post-row-copy">
                            <strong>{place.name}</strong>
                            <span>{place.subtitle || place.displayName}</span>
                            <small>Following since {formatPostTime(place.followedAt)}</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="saved-posts-section">
                  <button type="button" className="saved-posts-toggle" onClick={() => void toggleSavedPosts()} aria-expanded={savedPostsExpanded}>
                    <Bookmark size={16} />
                    <span>Saved posts</span>
                    <ChevronRight size={15} className={savedPostsExpanded ? "saved-posts-chevron open" : "saved-posts-chevron"} />
                  </button>
                  {savedPostsExpanded && (
                    <div className="saved-posts-content">
                      {savedPostsBusy ? <div className="notification-empty">Loading saved posts…</div>
                      : savedPostsError ? <div className="notification-empty" role="alert">{savedPostsError}</div>
                      : savedPosts.length === 0 ? <div className="notification-empty">Posts you save from a community will appear here.</div>
                      : savedPosts.map((item) => (
                        <button key={item.id} type="button" className="saved-post-row" onClick={() => {
                          const post = item.post;
                          if (!post.coordinates || !/^(node|way|relation)-[1-9]\d{0,17}$/.test(post.placeKey)) {
                            setSearchValue(post.placeName);
                            setSearchOpen(true);
                            setAuthModalOpen(false);
                            showNotice(`Search for ${post.placeName} to find this saved conversation.`);
                            return;
                          }
                          selectPlace({
                            id: post.placeKey,
                            name: post.placeName,
                            subtitle: "Saved community",
                            displayName: post.placeDisplayName,
                            kind: "Mapped place",
                            coordinates: post.coordinates,
                            zoom: 15,
                          });
                          setAuthModalOpen(false);
                          setSavedPostsExpanded(false);
                          showNotice(`Opened ${post.placeName}.`);
                        }}>
                          <span className="saved-post-row-copy">
                            <strong>{item.post.placeName}</strong>
                            <span>{item.post.body}</span>
                            <small>@{item.post.author.username} · {formatPostTime(item.post.createdAt)} · {item.post.likesCount} likes</small>
                          </span>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    </div>
                  )}
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

      {reportTarget && (
        <div className="report-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reportBusy) setReportTarget(null);
        }}>
          <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <button className="report-close icon-button" type="button" onClick={() => setReportTarget(null)} aria-label="Close report dialog" disabled={reportBusy}>
              <X size={16} />
            </button>
            <span className="report-modal-mark"><Flag size={19} /></span>
            <span className="eyebrow">COMMUNITY SAFETY</span>
            <h2 id="report-title">Report this {reportTarget.targetType}</h2>
            <p className="report-intro">Tell us what seems wrong. Reports are private and help the moderation team review content.</p>
            <div className="report-target-preview">
              <small>{reportTarget.placeName} · @{reportTarget.authorUsername}</small>
              <p>{reportTarget.body}</p>
            </div>
            <form className="report-form" onSubmit={(event) => void handleReportSubmit(event)}>
              <label>
                <span>Reason for reporting</span>
                <select value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)} disabled={reportBusy}>
                  <option value="spam">Spam or repetitive promotion</option>
                  <option value="harassment">Harassment or hateful content</option>
                  <option value="misinformation">Misleading or false information</option>
                  <option value="unsafe">Unsafe or threatening content</option>
                  <option value="privacy">Personal information or privacy concern</option>
                  <option value="other">Something else</option>
                </select>
              </label>
              <label>
                <span>Additional context <small>{reportDetails.length}/300</small></span>
                <textarea value={reportDetails} onChange={(event) => setReportDetails(event.target.value.slice(0, 300))} maxLength={300} rows={3} placeholder="Add a brief explanation (optional)." disabled={reportBusy} />
              </label>
              {reportError && <p className="report-error" role="alert">{reportError}</p>}
              <button className="auth-submit report-submit" type="submit" disabled={reportBusy}>
                {reportBusy ? <span className="mini-spinner" /> : <Flag size={15} />}
                {reportBusy ? "Sending report…" : "Send private report"}
              </button>
            </form>
            <p className="report-privacy-note">Reporting does not automatically remove content. A moderator will review the report.</p>
          </section>
        </div>
      )}

    </main>
  );
}
