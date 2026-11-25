/**
 * The lazily loaded pages, in one place so the router and the nav share them:
 * hovering or focusing a nav link calls `prefetchPage` to start downloading that page before the click.
 */
export const pageLoaders = {
  overview: () => import('./components/Overview'),
  platform: () => import('./components/workspace/PlatformPage'),
  facebook: () => import('./components/workspace/FacebookPage'),
  publish: () => import('./components/publish/PublishWizard'),
  scripts: () => import('./components/scripts/ScriptsPage'),
  accounts: () => import('./components/Accounts'),
  profile: () => import('./components/Profile'),
  automation: () => import('./components/Automation'),
  videoAi: () => import('./components/videoAi/VideoAiHome'),
  videoAiReport: () => import('./components/videoAi/AnalysisPage'),
};

const ROUTE_PAGE: Record<string, keyof typeof pageLoaders> = {
  '/overview': 'overview',
  '/instagram': 'platform',
  '/youtube': 'platform',
  '/linkedin': 'platform',
  '/facebook': 'facebook',
  '/publish': 'publish',
  '/scripts': 'scripts',
  '/accounts': 'accounts',
  '/profile': 'profile',
  '/automation': 'automation',
  '/analysis': 'videoAi',
};

const started = new Set<string>();

export function prefetchPage(path: string) {
  const page = ROUTE_PAGE[path];
  if (!page || started.has(page)) return;
  started.add(page);
  pageLoaders[page]().catch(() => started.delete(page));
}
