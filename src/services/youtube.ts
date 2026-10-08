import { env } from '../env';

export interface YoutubeVideo {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
}

interface CacheEntry {
  videos: YoutubeVideo[];
  fetchedAt: number;
}

// Keyed by channel handle — each app shows its own channel (App.youtubeChannelHandle).
const cache = new Map<string, CacheEntry>();
const uploadsPlaylistIds = new Map<string, string>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — video lists don't change often enough to warrant refetching every request, and this keeps us well under the API's daily quota.

const API_BASE = 'https://www.googleapis.com/youtube/v3';

async function getUploadsPlaylistId(handle: string): Promise<string> {
  const known = uploadsPlaylistIds.get(handle);
  if (known) return known;

  const url = `${API_BASE}/channels?part=contentDetails&forHandle=${encodeURIComponent(handle)}&key=${env.youtubeApiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`YouTube channel lookup failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    items?: { contentDetails: { relatedPlaylists: { uploads: string } } }[];
  };
  const playlistId = data.items?.[0]?.contentDetails.relatedPlaylists.uploads;
  if (!playlistId) {
    throw new Error(`No channel found for handle "${handle}"`);
  }
  uploadsPlaylistIds.set(handle, playlistId);
  return playlistId;
}

interface PlaylistItemsPage {
  items: {
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      resourceId: { videoId: string };
      thumbnails: { high?: { url: string }; medium?: { url: string }; default?: { url: string } };
    };
  }[];
  nextPageToken?: string;
}

async function fetchAllVideos(handle: string): Promise<YoutubeVideo[]> {
  const playlistId = await getUploadsPlaylistId(handle);
  const videos: YoutubeVideo[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('key', env.youtubeApiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`YouTube playlistItems fetch failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as PlaylistItemsPage;

    for (const item of data.items) {
      const s = item.snippet;
      // A video that's been deleted/privated after being added to the
      // uploads playlist still shows up here with a placeholder title —
      // skip it rather than showing a broken entry.
      if (s.title === 'Private video' || s.title === 'Deleted video') continue;
      videos.push({
        id: s.resourceId.videoId,
        title: s.title,
        description: s.description,
        publishedAt: s.publishedAt,
        thumbnail: s.thumbnails.high?.url || s.thumbnails.medium?.url || s.thumbnails.default?.url || '',
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return videos.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/**
 * Returns the channel's full uploaded-video list, newest first. Cached for
 * an hour server-side — this app has no background job runner, so the
 * cache is simply refreshed lazily on whichever request happens to land
 * after it expires.
 */
export async function getChannelVideos(handle: string | null | undefined): Promise<YoutubeVideo[]> {
  if (!env.youtubeApiKey || !handle) return [];

  const cached = cache.get(handle);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.videos;
  }

  try {
    const videos = await fetchAllVideos(handle);
    cache.set(handle, { videos, fetchedAt: Date.now() });
    return videos;
  } catch (err) {
    // A transient YouTube API hiccup (or a quota bump) shouldn't take the
    // gallery page down — serve the last known-good list if there is one,
    // otherwise an empty list, and let the next request retry.
    console.error('[youtube] Failed to refresh video list:', err);
    return cache.get(handle)?.videos ?? [];
  }
}
