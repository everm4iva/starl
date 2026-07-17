/*
 * ☆ Media routes
 * -> the audio + image surface: resolve/prewarm, proxy-stream, cached stream, thumbnails,
 *    and cache status/eviction. JSON POSTs require a header token; the GETs that <audio>
 *    and <img> elements hit accept ?token= as well (they can't set headers).
 */

import { Router } from 'express';
import { requireUser, requireUserOrToken, asyncHandler } from '../auth/middleware.js';
import { handleDownload, handlePrewarm, handlePrewarmBatch } from '../media/downloads.js';
import { proxyStream } from '../media/proxy.js';
import { handleLiveManifest, handleLiveSegment } from '../media/live.js';
import {
  handleStream, handleStreamByVideoId, handleImage, handleImageRes,
  handleCacheImage, handleCacheStatus, handleDeleteTrack, handleDeleteImage,
} from '../media/streaming.js';

export const mediaRouter = Router();

// --- resolve / prewarm (header-auth JSON) ---
mediaRouter.post('/download', requireUser, asyncHandler(handleDownload));
mediaRouter.post('/prewarm', requireUser, asyncHandler(handlePrewarm));
mediaRouter.post('/prewarm/batch', requireUser, asyncHandler(handlePrewarmBatch));

// --- streaming + images (token may ride in ?token=) ---
mediaRouter.get('/proxy/:audio_id', requireUserOrToken, asyncHandler(proxyStream));
mediaRouter.get('/live/manifest', requireUserOrToken, asyncHandler(handleLiveManifest));
mediaRouter.get('/live/segment', requireUserOrToken, asyncHandler(handleLiveSegment));
mediaRouter.get('/stream/v/:video_id', requireUserOrToken, asyncHandler(handleStreamByVideoId));
mediaRouter.get('/stream/:audio_id', requireUserOrToken, asyncHandler(handleStream));
mediaRouter.get('/image/:image_id', requireUserOrToken, asyncHandler(handleImage));
mediaRouter.get('/imgres/:image_id', requireUserOrToken, asyncHandler(handleImageRes));
mediaRouter.get('/cache/image', requireUserOrToken, asyncHandler(handleCacheImage));

// --- cache management (header-auth) ---
mediaRouter.get('/cache/status', requireUser, asyncHandler(handleCacheStatus));
mediaRouter.delete('/cache/track', requireUser, asyncHandler(handleDeleteTrack));
mediaRouter.delete('/cache/image', requireUser, asyncHandler(handleDeleteImage));
