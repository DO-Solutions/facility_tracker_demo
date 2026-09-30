import { useEffect, useState } from 'react';
import { api, type Features } from './api';

// Fixed for the life of a deployment, so fetch once and share.
let cached: Promise<Features> | null = null;

/**
 * Which optional parts of the pipeline are on. Null until known; callers
 * should render the GitHub-free version until then, since that is the
 * default and the less surprising thing to flash.
 */
export function useFeatures(): Features | null {
  const [features, setFeatures] = useState<Features | null>(null);
  useEffect(() => {
    cached ??= api.features().catch(() => ({ githubIssues: false }));
    cached.then(setFeatures);
  }, []);
  return features;
}
