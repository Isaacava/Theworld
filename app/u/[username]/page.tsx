"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Compass, Globe, MapPin, MessageCircle, ShieldCheck } from "lucide-react";

type ProfilePost = {
  id: string;
  body: string;
  type: string;
  placeKey: string;
  placeName: string;
  createdAt: string;
  presenceVerifiedAt: string | null;
  isRemoteQuestion: boolean;
  replyCount: number;
  images?: { id: string; url: string }[];
};

type ProfilePayload = {
  profile: {
    username: string;
    displayName: string;
    bio: string;
    createdAt: string;
  };
  stats: { posts: number; replies: number };
  posts: ProfilePost[];
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date);
}

function formatPostDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (parts[0]?.slice(0, 1) || "W").toUpperCase();
}

export default function PublicProfilePage() {
  const params = useParams<{ username: string }>();
  const username = typeof params.username === "string" ? params.username.toLowerCase() : "";
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!username) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/users/${encodeURIComponent(username)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.profile) {
          throw new Error(typeof result.error === "string" ? result.error : "We couldn't find this profile.");
        }
        setPayload(result as ProfilePayload);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setPayload(null);
        setError(reason instanceof Error ? reason.message : "We couldn't load this profile.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [username]);

  const profile = payload?.profile;

  return (
    <main className="profile-page">
      <nav className="profile-page-nav" aria-label="Main navigation">
        <Link className="profile-page-brand" href="/">
          <span className="profile-page-brand-mark">W</span>
          <span><strong>THE WORLD</strong><small>A social map of Earth</small></span>
        </Link>
        <Link className="profile-back-link" href="/"><ArrowLeft size={15} /> Back to explore</Link>
      </nav>

      <div className="profile-page-content">
        <section className="profile-main-column">
          {loading ? (
            <div className="profile-state-card" role="status">
              <span className="profile-loading-mark" />
              <strong>Finding this profile</strong>
              <p>Loading public details and contributions.</p>
            </div>
          ) : error || !payload || !profile ? (
            <div className="profile-state-card">
              <span className="profile-state-icon">?</span>
              <h1>Profile unavailable</h1>
              <p>{error || "This profile could not be found."}</p>
              <Link className="profile-primary-link" href="/"><Compass size={16} /> Explore THE WORLD</Link>
            </div>
          ) : (
            <>
              <section className="profile-hero-card">
                <div className="profile-identity-row">
                  <div className="profile-avatar-large" aria-hidden="true">{initials(profile.displayName)}</div>
                  <div className="profile-identity-copy">
                    <span className="profile-overline">WORLD IDENTITY</span>
                    <h1>{profile.displayName}</h1>
                    <p className="profile-handle">@{profile.username}</p>
                  </div>
                </div>
                <p className={profile.bio ? "profile-bio" : "profile-bio profile-bio-empty"}>
                  {profile.bio || "This explorer hasn’t added an introduction yet."}
                </p>
                <div className="profile-stat-row" aria-label="Contribution statistics">
                  <div><strong>{payload.stats.posts.toLocaleString()}</strong><span>Posts</span></div>
                  <div><strong>{payload.stats.replies.toLocaleString()}</strong><span>Replies</span></div>
                  <div><strong>{payload.posts.length.toLocaleString()}</strong><span>Recent shown</span></div>
                </div>
              </section>

              <section className="profile-contributions">
                <div className="profile-section-heading">
                  <div><span className="profile-overline">FROM THIS EXPLORER</span><h2>Recent contributions</h2></div>
                  <span>{payload.stats.posts.toLocaleString()} total</span>
                </div>
                {payload.posts.length === 0 ? (
                  <div className="profile-empty-posts">
                    <MapPin size={20} />
                    <strong>No public posts yet</strong>
                    <p>When this explorer shares something with a local community, it will appear here.</p>
                  </div>
                ) : (
                  <div className="profile-post-list">
                    {payload.posts.map((post) => (
                      <article className="profile-post-card" key={post.id}>
                        <div className="profile-post-topline">
                          <span className={`profile-post-type profile-post-type-${post.type}`}>{post.type}</span>
                          {post.isRemoteQuestion && <span className="profile-remote-question-badge"><Globe size={11} /> Asking from elsewhere</span>}
                          <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time>
                        </div>
                        <p className="profile-post-body">{post.body}</p>
                        {post.images && post.images.length > 0 && (
                          <div className="community-post-images profile-post-images">
                            {post.images.map((image, index) => <a href={image.url} key={image.id} target="_blank" rel="noreferrer noopener" aria-label={`Open photo ${index + 1} in full size`}><Image src={image.url} alt={`Photo shared by @${payload.profile.username}`} width={960} height={720} unoptimized /></a>)}
                          </div>
                        )}
                        <div className="profile-post-footer">
                          <span><MapPin size={13} /> {post.placeName}</span>
                          <span><MessageCircle size={13} /> {post.replyCount} {post.replyCount === 1 ? "reply" : "replies"}</span>
                          {post.presenceVerifiedAt && <span><ShieldCheck size={13} /> Presence checked when posted</span>}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </section>

        {!loading && !error && profile && payload && (
          <aside className="profile-sidebar">
            <section className="profile-side-card">
              <span className="profile-overline">ABOUT</span>
              <h2>Explorer since</h2>
              <div className="profile-fact-row"><CalendarDays size={16} /><span>{formatDate(profile.createdAt)}</span></div>
              <p>Profile details and contributions are public. Email addresses and account credentials are never shown here.</p>
            </section>
            <section className="profile-side-card profile-side-note">
              <span className="profile-side-note-icon"><Compass size={17} /></span>
              <h2>Places bring us together.</h2>
              <p>Explore anywhere. Join a local conversation when your presence can be verified.</p>
              <Link className="profile-primary-link" href="/">Open the map <ArrowLeft size={14} className="profile-link-arrow" /></Link>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
