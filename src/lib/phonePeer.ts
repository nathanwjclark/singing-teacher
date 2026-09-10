export type PhoneSession = { sessionId: string; token: string; pairUrl: string; secure: boolean; connectionHint?: string };
type Signal = { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

export async function phoneRequest<T>(session: Pick<PhoneSession, 'sessionId' | 'token'>, path = '', init?: RequestInit): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const response = await fetch(`/api/pair/${encodeURIComponent(session.sessionId)}${path}${separator}token=${encodeURIComponent(session.token)}`, init);
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Phone connection failed (${response.status})`);
  return response.json() as Promise<T>;
}

/** LAN-only audio transport. No audio is uploaded or recorded by this helper. */
export function createPhonePeer(session: PhoneSession, role: 'phone' | 'desktop', onStream: (stream: MediaStream | null) => void, onStatus: (status: string) => void) {
  let peer: RTCPeerConnection | undefined;
  let closed = false;
  let after = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingCandidates: RTCIceCandidateInit[] = [];
  const send = (signal: Signal) => phoneRequest(session, '/signals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: role, signal }) });
  const create = () => {
    peer?.close();
    const next = new RTCPeerConnection({ iceServers: [] });
    peer = next;
    next.onicecandidate = event => { if (event.candidate && !closed) void send({ candidate: event.candidate.toJSON() }).catch(error => onStatus(String(error))); };
    next.ontrack = event => { onStream(event.streams[0] ?? new MediaStream([event.track])); };
    next.onconnectionstatechange = () => {
      if (closed || peer !== next) return;
      onStatus(next.connectionState === 'connected' ? 'Phone microphone connected' : `Microphone: ${next.connectionState}`);
      if (['failed', 'disconnected', 'closed'].includes(next.connectionState)) onStream(null);
    };
    return next;
  };
  const poll = async () => {
    try {
      const response = await phoneRequest<{ messages: Array<{ id: number; signal: Signal }> }>(session, `/signals?role=${role}&after=${after}`);
      for (const message of response.messages) {
        if (closed) return;
        after = Math.max(after, message.id);
        const signal = message.signal;
        if (signal.description) {
          const connection = signal.description.type === 'offer' ? create() : peer;
          if (!connection) continue;
          await connection.setRemoteDescription(signal.description);
          for (const candidate of pendingCandidates) await connection.addIceCandidate(candidate);
          pendingCandidates = [];
          if (signal.description.type === 'offer') {
            await connection.setLocalDescription(await connection.createAnswer());
            await send({ description: connection.localDescription!.toJSON() });
          }
        } else if (signal.candidate) {
          if (peer?.remoteDescription) await peer.addIceCandidate(signal.candidate);
          else pendingCandidates.push(signal.candidate);
        }
      }
    } catch (error) { if (!closed) onStatus(error instanceof Error ? error.message : 'Phone connection interrupted'); }
    if (!closed) timer = setTimeout(() => void poll(), 800);
  };
  void poll();
  return {
    async sendMicrophone(stream: MediaStream) {
      const connection = create();
      stream.getAudioTracks().forEach(track => connection.addTrack(track, stream));
      await connection.setLocalDescription(await connection.createOffer());
      await send({ description: connection.localDescription!.toJSON() });
      onStatus('Connecting phone microphone…');
    },
    close() { closed = true; clearTimeout(timer); peer?.close(); onStream(null); },
  };
}
