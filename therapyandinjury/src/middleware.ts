import { defineMiddleware } from 'astro:middleware';
import { refreshContent } from './lib/content-store';

// Pick up content editor changes (content.json) before each page renders.
export const onRequest = defineMiddleware((_ctx, next) => {
  refreshContent();
  return next();
});
