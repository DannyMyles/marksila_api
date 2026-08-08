import { Router } from 'express';
import { getChannelVideos } from '../services/youtube';

export const youtubeRouter = Router();

/**
 * @openapi
 * /api/v1/youtube/videos:
 *   get:
 *     summary: List all videos from the channel's uploads (public, cached server-side for an hour)
 *     tags: [YouTube]
 */
youtubeRouter.get('/videos', async (_req, res, next) => {
  try {
    const videos = await getChannelVideos();
    res.json({ videos });
  } catch (err) {
    next(err);
  }
});
