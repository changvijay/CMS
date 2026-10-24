import type { Platform } from '../../services/api';
import { InstagramAudience } from '../InstagramAudience';
import { YoutubeAudience } from '../YoutubeAudience';
import { InstagramAccountInsights } from './InstagramAccountInsights';
import { InstagramDemographicsPanel } from './InstagramDemographics';

interface Props {
  platform: Platform;
  token: string;
  accountId: string;
  since: string;
  until: string;
}

/** Audience insights come straight from the platforms, so they work before any history is stored. */
export function AudienceTab({ platform, token, accountId, since, until }: Props) {
  return platform === 'instagram' ? (
    <>
      <h3 className="ws-section-title">Reach and discovery</h3>
      <InstagramAccountInsights token={token} accountId={accountId} since={since} until={until} />
      <h3 className="ws-section-title">When your followers are online</h3>
      <InstagramAudience token={token} accountId={accountId} />
      <h3 className="ws-section-title">Who follows you</h3>
      <InstagramDemographicsPanel token={token} accountId={accountId} type="follower" />
      <h3 className="ws-section-title">Who engages with you</h3>
      <InstagramDemographicsPanel token={token} accountId={accountId} type="engaged" />
    </>
  ) : (
    <YoutubeAudience token={token} accountId={accountId} since={since} until={until} />
  );
}
