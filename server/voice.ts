import { createHmac, randomUUID } from 'node:crypto';
import type { Application } from 'express';
import express from 'express';
import { AccessToken, RoomServiceClient, TokenVerifier, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import type { VoiceCredentials, VoiceMember } from '../src/shared/voice';
import type { HallId } from '../src/shared/world';

type Admission = { room: string; current: () => boolean };
export type VoiceAdmission = { credentials: VoiceCredentials; close: () => void };

class VoiceService {
  private readonly admissions = new Map<string, Admission>();
  private readonly rooms: RoomServiceClient;
  private readonly verifier: TokenVerifier;
  private readonly webhooks: WebhookReceiver;

  constructor(private readonly url: string, apiUrl: string, private readonly key: string, private readonly secret: string) {
    this.rooms = new RoomServiceClient(apiUrl, key, secret, { requestTimeout: 3 });
    this.verifier = new TokenVerifier(key, secret);
    this.webhooks = new WebhookReceiver(key, secret);
  }

  async admit(lobby: string, hall: HallId, playerId: string, accountId: string, current: () => boolean): Promise<VoiceAdmission | undefined> {
    const room = `royal-${lobby}-${hall}`;
    const identity = randomUUID();
    const member: VoiceMember = { playerId, muteKey: createHmac('sha256', this.secret).update(`royal-voice:${accountId}`).digest('base64url') };
    const token = new AccessToken(this.key, this.secret, { identity, ttl: '1m', metadata: JSON.stringify(member) });
    token.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true,
      canPublishSources: [TrackSource.MICROPHONE], canPublishData: false, canUpdateOwnMetadata: false });
    const jwt = await token.toJwt();
    if (!current()) return undefined;
    this.admissions.set(identity, { room, current });
    const credentials: VoiceCredentials = { url: this.url, token: jwt, hall };
    return { credentials, close: () => {
      if (this.admissions.delete(identity)) void this.disconnect(room, identity);
    } };
  }

  private allowed(room: string, identity: string) {
    const admission = this.admissions.get(identity);
    return admission?.room === room && admission.current();
  }

  private async disconnect(room: string, identity: string, retry = true) {
    try {
      await this.rooms.removeParticipant(room, identity);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) return;
      if (retry) setTimeout(() => { void this.disconnect(room, identity, false); }, 1000).unref();
      else console.warn('Voice participant removal failed');
    }
  }

  install(app: Application) {
    // The media host forwards every public signaling handshake here, including SDK reconnects.
    app.get('/internal/voice/authorize', async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const uri = new URL(req.get('x-forwarded-uri') ?? '/', 'https://voice.invalid');
        const token = req.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1] ?? uri.searchParams.get('access_token');
        if (!token || token.length > 4096) { res.sendStatus(403); return; }
        const claims = await this.verifier.verify(token);
        const room = claims.video?.room;
        const identity = claims.sub;
        res.sendStatus(room && identity && claims.video?.roomJoin && this.allowed(room, identity) ? 204 : 403);
      } catch {
        res.sendStatus(403);
      }
    });
    // A handshake can already be in flight when admission is revoked.
    app.post('/internal/voice/events', express.text({ type: 'application/webhook+json', limit: '32kb' }), async (req, res) => {
      try {
        if (typeof req.body !== 'string') { res.sendStatus(403); return; }
        const event = await this.webhooks.receive(req.body, req.get('authorization'));
        if (event.event === 'participant_joined' && event.room?.name.startsWith('royal-') && event.participant) {
          const { name } = event.room;
          const { identity } = event.participant;
          if (!this.allowed(name, identity)) await this.disconnect(name, identity);
        }
        res.sendStatus(204);
      } catch {
        res.sendStatus(403);
      }
    });
  }
}

const { VOICE_PUBLIC_URL, VOICE_API_URL, VOICE_API_KEY, VOICE_API_SECRET } = process.env;
export const voice = VOICE_PUBLIC_URL && VOICE_API_URL && VOICE_API_KEY && VOICE_API_SECRET
  ? new VoiceService(VOICE_PUBLIC_URL, VOICE_API_URL, VOICE_API_KEY, VOICE_API_SECRET)
  : undefined;
