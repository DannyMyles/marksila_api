import { Router } from 'express';
import { getChannelVideos } from '../services/youtube';
import { tenantOf } from '../middleware/tenant';

export const youtubeRouter = Router();

/**
 * @openapi
 * /api/v1/youtube/videos:
 *   get:
 *     summary: List this app's YouTube channel uploads (public, cached server-side for an hour)
 *     tags: [YouTube]
 */
youtubeRouter.get('/videos', async (req, res, next) => {
  try {
    const videos = await getChannelVideos(tenantOf(req).youtubeChannelHandle);
    res.json({ videos });
  } catch (err) {
    next(err);
  }
});
