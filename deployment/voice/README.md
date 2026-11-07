# Location voice

Royal keeps voice access tied to the authenticated lobby connection and its current hall. The browser sends mono Opus audio to LiveKit over WebRTC. LiveKit forwards it to listeners in the corresponding lobby and hall. Voice stays connected while a game opened in the club is running. The direct casino catalogue has no voice zone.

The whole-chat switch and individual mutes live in the current browser tab. A player can open the existing chat panel and select Players during a game. The list shows the other voice participants in that location with current speakers first. The browser may require a click or key press to play incoming audio. The first push-to-talk requests microphone permission.

## Separate media host

1. Run LiveKit and Caddy on the media host. Use the supplied configuration files. Copy the LiveKit example outside Git, replace the two key placeholders with a dedicated key and a random secret of at least 32 characters, and set the webhook URL to Royal's HTTPS origin.
2. Set `ROYAL_VOICE_DOMAIN` in Caddy to the public media hostname, and `ROYAL_GAME_ORIGIN` to Royal's HTTPS origin. The voice hostname needs DNS and a valid TLS certificate. Keep LiveKit's HTTP port 7880 on loopback. Allow Caddy's HTTPS traffic plus media ports 7881/TCP and 7882/UDP. Enable a TURN fallback for target networks that require it and verify it from an external network. Keep public signaling behind the supplied authorization check, including fallback deployments.
3. Configure `VOICE_PUBLIC_URL` as `wss://<voice-hostname>` and `VOICE_API_URL` as `https://<voice-hostname>` in Royal's server environment. Set `VOICE_API_KEY` and `VOICE_API_SECRET` to the matching LiveKit credentials. The feature is optional and Royal exposes its voice controls only when all four values are set.

The signaling proxy checks the token against current game membership before forwarding each join or reconnect. When a player leaves a zone, Royal revokes that admission and removes the LiveKit participant. The signed webhook also catches a participant whose connection was already in flight during revocation. Media uses the dedicated host and is not routed through the game process.

## Verification before enabling

Use two browser accounts in the same lobby. Verify audio in both directions, silence on release and focus loss, transitions through the lift and doors, and denied reuse of an old zone token. Check the desktop game window and mobile chat overlay, including muting someone while the game stays open, refresh persistence, and the global switch. Check at least one mobile or VPN connection over TCP or TURN in addition to UDP.

For capacity, begin with a staging test on 2 available vCPU and 2 to 4 GB RAM. For 30 listeners in one location, assuming roughly 50 to 70 kbit/s on the wire per active speaker per recipient, three simultaneous speakers need about 4.4 to 6.1 Mbit/s outbound. Measure CPU, packet loss, jitter and outbound bandwidth under the expected number of concurrent lobbies before assigning production capacity.
