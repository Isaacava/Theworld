"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Building2, Compass, MapPin, RefreshCw, Route } from "lucide-react";

type LngLat = [number, number];
type NearbyPlace = {
  id: string;
  osmPlaceKey: string;
  name: string;
  subtitle: string;
  displayName: string;
  kind: string;
  coordinates: LngLat;
  zoom: number;
  distanceMeters: number;
  conversationCount: number;
};
type ParentPlace = { id: string; name: string; displayName: string; kind: string; coordinates: LngLat };
type SelectablePlace = Omit<NearbyPlace, "osmPlaceKey" | "distanceMeters" | "conversationCount">;
type NearbyActivity = {
  id: string;
  body: string;
  type: string;
  placeKey: string;
  placeName: string;
  placeDisplayName: string;
  author: { username: string; displayName: string };
  createdAt: string;
  replyCount: number;
  isRemoteQuestion: boolean;
  coordinates: LngLat;
};
type Props = {
  place: ParentPlace;
  onSelect: (place: SelectablePlace) => void;
  onOpenConversation: (placeKey: string, postId: string) => void;
};

function activityTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Recently";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(timestamp));
}

function distanceLabel(meters: number) {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m away`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km away`;
}

export default function NearbyCommunities({ place, onSelect, onOpenConversation }: Props) {
  const [items, setItems] = useState<NearbyPlace[]>([]);
  const [activity, setActivity] = useState<NearbyActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/places/nearby?placeKey=${encodeURIComponent(place.id)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Nearby places could not be loaded.");
      setItems(Array.isArray(payload.communities) ? payload.communities as NearbyPlace[] : []);
      setActivity(Array.isArray(payload.activity) ? payload.activity as NearbyActivity[] : []);
      setStale(payload.stale === true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nearby places could not be loaded.");
      setItems([]);
      setActivity([]);
    } finally {
      setLoading(false);
    }
  }, [place.id]);

  useEffect(() => { void load(); }, [load]);

  const cityLike = /city|town|municipality|village/i.test(place.kind);
  return (
    <section className="nearby-communities" aria-label={`Nearby communities around ${place.name}`}>
      <div className="nearby-communities-heading">
        <div>
          <span className="eyebrow">{cityLike ? "EXPLORE THE AREA" : "AROUND THIS PLACE"}</span>
          <h3>{cityLike ? "Neighbourhoods and places nearby" : "Places around here"}</h3>
          <p>Open a mapped street or neighbourhood to explore its own conversations.</p>
        </div>
        <button className="nearby-communities-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh nearby places">
          <RefreshCw size={15} className={loading ? "community-refresh-spinning" : ""} />
        </button>
      </div>

      <div className="nearby-communities-note">
        <Compass size={15} />
        <span>These are nearby mapped places, not a claim that each one sits inside an official city boundary.</span>
      </div>

      {error && (
        <div className="nearby-communities-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>Retry</button>
        </div>
      )}
      {loading ? (
        <div className="nearby-communities-state"><span className="mini-spinner" /> Finding places around {place.name}…</div>
      ) : !error && items.length === 0 ? (
        <div className="nearby-communities-empty">
          <MapPin size={20} />
          <strong>No nearby named communities found</strong>
          <p>Try searching for a specific street, suburb, or neighbourhood.</p>
        </div>
      ) : (
        <div className="nearby-communities-list">
          {items.map((item) => (
            <button className="nearby-community-row" key={item.osmPlaceKey} type="button" onClick={() => onSelect({
              id: item.id,
              name: item.name,
              subtitle: item.subtitle,
              displayName: item.displayName,
              kind: item.kind,
              coordinates: item.coordinates,
              zoom: item.zoom,
            })}>
              <span className="nearby-community-icon">{item.kind === "Street" ? <Route size={17} /> : <Building2 size={17} />}</span>
              <span className="nearby-community-copy">
                <strong>{item.name}</strong>
                <small>{item.kind} · {distanceLabel(item.distanceMeters)}</small>
                <span>{item.conversationCount > 0 ? `${item.conversationCount} ${item.conversationCount === 1 ? "conversation" : "conversations"}` : "Open community"}</span>
              </span>
              <ArrowUpRight size={16} className="nearby-community-arrow" />
            </button>
          ))}
        </div>
      )}


      {!loading && !error && (
        <section className="nearby-area-activity" aria-label="Recent conversations in nearby communities">
          <div className="nearby-area-activity-heading">
            <div><span className="eyebrow">LOCAL ACTIVITY</span><h4>Recent conversations nearby</h4></div>
            <span>{activity.length ? `Latest ${activity.length}` : "New area"}</span>
          </div>
          <p className="nearby-area-activity-note">These posts stay attached to their actual street or neighbourhood, rather than being relabelled as posts for {place.name}.</p>
          {activity.length ? (
            <div className="nearby-area-activity-list">
              {activity.map((post) => (
                <article className="nearby-area-activity-card" key={post.id}>
                  <div className="nearby-area-activity-meta">
                    <span className="nearby-area-post-place"><MapPin size={11} /> {post.placeName}</span>
                    <small>{activityTime(post.createdAt)}</small>
                  </div>
                  <div className="nearby-area-activity-author">
                    <strong>{post.author.displayName || post.author.username}</strong>
                    <small>@{post.author.username} · {post.isRemoteQuestion ? "Asking from elsewhere" : post.type}</small>
                  </div>
                  <p>{post.body}</p>
                  <button type="button" onClick={() => onOpenConversation(post.placeKey, post.id)}>
                    Open conversation <ArrowUpRight size={13} />
                    <span>{post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}</span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="nearby-area-activity-empty">
              <strong>No recent conversations in the listed nearby places</strong>
              <p>Open a nearby community above to see its complete feed or start a useful conversation.</p>
            </div>
          )}
        </section>
      )}
      {stale && <p className="nearby-communities-stale">Showing the most recently cached map results.</p>}
      <div className="nearby-communities-footer"><MapPin size={12} /> Place data from OpenStreetMap. Conversation counts include visible posts only.</div>
    </section>
  );
}
