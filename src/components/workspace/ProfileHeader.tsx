import { useEffect, useState } from 'react';
import {
  fetchInstagramProfile,
  fetchLinkedInProfile,
  fetchYoutubeChannel,
  type InstagramProfile,
  type LinkedInProfile,
  type Platform,
  type YoutubeChannelInfo,
} from '../../services/api';
import { formatCompact } from '../charts/viz';
import { errorMessage } from '../../utils/errors';

interface Props {
  platform: Platform;
  token: string;
  accountId: string;
  accountName: string;
}

interface Card {
  title: string;
  handle: string | null;
  bio: string;
  avatar: string | null;
  link: string | null;
  stats: { label: string; value: string }[];
}

function toInstagramCard(p: InstagramProfile, fallbackName: string): Card {
  return {
    title: p.name || p.username || fallbackName,
    handle: p.username ? `@${p.username}` : null,
    bio: p.biography || '',
    avatar: p.profile_picture_url || null,
    link: p.username ? `https://www.instagram.com/${p.username}/` : null,
    stats: [
      { label: 'Followers', value: formatCompact(p.followers_count) },
      { label: 'Following', value: formatCompact(p.follows_count) },
      { label: 'Posts', value: formatCompact(p.media_count) },
    ],
  };
}

function toYoutubeCard(c: YoutubeChannelInfo): Card {
  return {
    title: c.title,
    handle: c.custom_url,
    bio: c.description,
    avatar: c.thumbnail_url,
    link: c.custom_url ? `https://www.youtube.com/${c.custom_url.startsWith('@') ? c.custom_url : `@${c.custom_url}`}` : null,
    stats: [
      { label: 'Subscribers', value: c.subscriber_count === null ? 'Hidden' : formatCompact(c.subscriber_count) },
      { label: 'Total views', value: formatCompact(c.view_count) },
      { label: 'Videos', value: formatCompact(c.video_count) },
    ],
  };
}

function toLinkedInCard(p: LinkedInProfile): Card {
  return {
    title: p.name,
    handle: p.vanity_name ? `linkedin.com/company/${p.vanity_name}` : null,
    bio: p.description || '',
    avatar: null,
    link: p.vanity_name ? `https://www.linkedin.com/company/${p.vanity_name}/` : null,
    stats: [
      { label: 'Followers', value: p.followers === null ? '–' : formatCompact(p.followers) },
      ...(p.staff_count ? [{ label: 'Company size', value: p.staff_count.replace(' employees', '') }] : []),
    ],
  };
}

export function ProfileHeader({ platform, token, accountId, accountName }: Props) {
  const [card, setCard] = useState<Card | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next =
          platform === 'instagram'
            ? toInstagramCard(await fetchInstagramProfile(token, accountId), accountName)
            : platform === 'linkedin'
              ? toLinkedInCard(await fetchLinkedInProfile(token, accountId))
              : toYoutubeCard(await fetchYoutubeChannel(token, accountId));
        if (cancelled) return;
        setCard(next);
        setNote(null);
        setAvatarFailed(false);
      } catch (err) {
        if (cancelled) return;
        setCard(null);
        setNote(errorMessage(err, 'Live profile is unavailable.'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, token, accountId, accountName]);

  const title = card?.title ?? accountName;
  const initial = title.charAt(0).toUpperCase();

  return (
    <section className="ws-profile">
      <div className="ws-avatar" aria-hidden="true">
        {card?.avatar && !avatarFailed ? <img src={card.avatar} alt="" onError={() => setAvatarFailed(true)} /> : initial}
      </div>
      <div className="ws-profile-main">
        <h2>
          {card?.link ? <a href={card.link} target="_blank" rel="noreferrer">{title}</a> : title}
        </h2>
        {card?.handle && <span className="ws-handle">{card.handle}</span>}
        {card?.bio && <p className="ws-bio">{card.bio}</p>}
        {note && <p className="ws-profile-note">Live profile details unavailable. {note}</p>}
      </div>
      {card && (
        <dl className="ws-profile-stats">
          {card.stats.map((s) => (
            <div key={s.label}>
              <dd>{s.value}</dd>
              <dt>{s.label}</dt>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
