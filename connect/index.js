import {
  FORM_URL,
  RANDOM_LOBBY,
  SHEET_QUERY_URL,
  busyTarget,
  createPeerId,
  createRoomCode,
  findWaitingPeer,
  formBody,
  latestSignalsByPeer,
  parseRoomCode,
  parseSheetResponse,
  partnerHasLeft,
  roomLobby,
  summarizeLobby
} from './signaling.js';

const AGE_STORAGE_KEY = 'connect-age-confirmed';
const POLL_INTERVAL_MS = 2_500;
const IDLE_PRESENCE_INTERVAL_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 20_000;
const PRESENCE_HEARTBEAT_MS = 8_000;

const localVideo = document.querySelector('#local-video');
const remoteVideo = document.querySelector('#remote-video');
const statusText = document.querySelector('#connection-status');
const presenceText = document.querySelector('#lobby-presence');
const ageGate = document.querySelector('#age-gate');
const ageConfirm = document.querySelector('#age-confirm');
const startButton = document.querySelector('#start-button');
const inviteButton = document.querySelector('#invite-button');
const nextButton = document.querySelector('#next-button');
const stopButton = document.querySelector('#stop-button');
const muteButton = document.querySelector('#mute-button');
const cameraButton = document.querySelector('#camera-button');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const chatMessages = document.querySelector('#chat-messages');

const state = {
  peerId: createPeerId(),
  roomCode: parseRoomCode(new URLSearchParams(location.search).get('room')),
  hosting: false,
  localStream: null,
  connection: null,
  channel: null,
  remotePeerId: null,
  mode: 'idle',
  handshakeDeadline: 0,
  lastPresencePostAt: 0,
  lastPollAt: 0,
  pollTimer: null,
  pollInFlight: false,
  starting: false
};

function lobby() {
  return state.roomCode ? roomLobby(state.roomCode) : RANDOM_LOBBY;
}

function setStatus(message, tone = 'neutral') {
  statusText.textContent = message;
  statusText.dataset.tone = tone;
}

function ageConfirmed() {
  return ageConfirm.checked;
}

function setControls() {
  const active = state.mode !== 'idle';
  const allowed = ageConfirmed();
  ageGate.hidden = active;
  startButton.hidden = active;
  startButton.disabled = state.starting || !allowed;
  startButton.textContent = state.roomCode ? 'Join private room' : 'Start video chat';
  inviteButton.hidden = Boolean(state.roomCode) && !state.hosting;
  inviteButton.disabled = !allowed;
  nextButton.hidden = !active || Boolean(state.roomCode);
  stopButton.hidden = !active;
  muteButton.hidden = !state.localStream;
  cameraButton.hidden = !state.localStream;
  chatInput.disabled = !state.channel || state.channel.readyState !== 'open';
  chatForm.querySelector('button').disabled = chatInput.disabled;
}

function inviteUrl(roomCode = state.roomCode) {
  const url = new URL(location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('room', roomCode);
  return url.href;
}

function setRoom(code) {
  state.roomCode = code;
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
  setControls();
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function renderPresence(signals) {
  if (state.roomCode) {
    const lobbyId = lobby();
    const friendHere = [...latestSignalsByPeer(signals).values()].some(
      (signal) =>
        signal.peer !== state.peerId && signal.kind === 'waiting' && signal.target === lobbyId
    );
    if (state.mode === 'connected') {
      presenceText.dataset.state = 'ready';
      presenceText.textContent = 'You are in your private room.';
    } else if (friendHere) {
      presenceText.dataset.state = 'ready';
      presenceText.textContent = 'Your friend is in the room.';
    } else {
      presenceText.dataset.state = 'empty';
      presenceText.textContent = 'Your friend has not opened the link yet.';
    }
    return;
  }

  const { ready, inCall } = summarizeLobby(signals, state.peerId);
  if (ready > 0) {
    presenceText.dataset.state = 'ready';
    const calls = inCall ? ` · ${plural(inCall, 'person', 'people')} in calls` : '';
    presenceText.textContent = `${plural(ready, 'person', 'people')} waiting to match${calls}`;
  } else if (inCall > 0) {
    presenceText.dataset.state = 'busy';
    presenceText.textContent = `${plural(
      inCall,
      'person is',
      'people are'
    )} here, all in calls. Next will wait for someone to free up.`;
  } else {
    presenceText.dataset.state = 'empty';
    presenceText.textContent = 'No one else is here right now. Invite a friend, or wait here.';
  }
}

function addMessage(text, direction = 'incoming') {
  const item = document.createElement('li');
  item.className = `message message--${direction}`;
  item.textContent = text;
  chatMessages.append(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function clearMessages() {
  chatMessages.replaceChildren();
}

async function getLocalMedia() {
  if (state.localStream) return state.localStream;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: { echoCancellation: true, noiseSuppression: true }
  });
  state.localStream = stream;
  localVideo.srcObject = stream;
  localVideo.closest('.video-card').classList.add('has-video');
  setControls();
  return stream;
}

function stopConnection() {
  const channel = state.channel;
  const connection = state.connection;
  state.channel = null;
  state.connection = null;
  state.remotePeerId = null;
  remoteVideo.srcObject = null;
  remoteVideo.closest('.video-card').classList.remove('has-video');
  clearMessages();
  channel?.close();
  connection?.close();
}

function makeConnection() {
  stopConnection();

  const connection = new RTCPeerConnection({
    iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
  });
  state.connection = connection;

  for (const track of state.localStream.getTracks()) {
    connection.addTrack(track, state.localStream);
  }

  connection.addEventListener('track', (event) => {
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.closest('.video-card').classList.add('has-video');
    }
    playRemoteVideo();
  });

  connection.addEventListener('datachannel', (event) => {
    attachChannel(event.channel);
  });

  connection.addEventListener('connectionstatechange', () => {
    if (connection !== state.connection) return;

    if (connection.connectionState === 'connected') {
      state.mode = 'connected';
      state.handshakeDeadline = 0;
      state.lastPresencePostAt = 0;
      setStatus(
        state.roomCode ? 'You are connected with your friend' : 'You are connected',
        'success'
      );
      setControls();
      playRemoteVideo();
    }

    if (['failed', 'closed'].includes(connection.connectionState) && state.mode !== 'idle') {
      setStatus(
        state.roomCode
          ? 'Connection ended. Waiting in your room…'
          : 'Connection ended. Finding someone new…'
      );
      void joinQueue();
    }
  });

  return connection;
}

function playRemoteVideo() {
  if (!remoteVideo.srcObject) return;
  remoteVideo.play().catch(() => {
    setStatus('Tap their video to start it', 'neutral');
    remoteVideo.addEventListener('click', () => void remoteVideo.play(), { once: true });
  });
}

function attachChannel(channel) {
  state.channel = channel;
  channel.addEventListener('open', () => {
    setControls();
  });
  channel.addEventListener('close', () => {
    setControls();
  });
  channel.addEventListener('message', (event) => {
    if (typeof event.data === 'string') addMessage(event.data);
  });
}

function waitForIceGathering(connection) {
  if (connection.iceGatheringState === 'complete') return Promise.resolve();

  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 5_000);
    function done() {
      window.clearTimeout(timeout);
      connection.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    }
    function onChange() {
      if (connection.iceGatheringState === 'complete') done();
    }
    connection.addEventListener('icegatheringstatechange', onChange);
  });
}

async function postSignal(kind, target = '', payload = '') {
  await fetch(FORM_URL, {
    method: 'POST',
    mode: 'no-cors',
    body: formBody({ peer: state.peerId, kind, target, payload })
  });
}

function readSignals() {
  const callbackName = `connectSheet_${crypto.randomUUID().replaceAll('-', '')}`;
  const url = new URL(SHEET_QUERY_URL);
  url.searchParams.set('tqx', `out:json;responseHandler:${callbackName}`);
  url.searchParams.set('_', String(Date.now()));

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const cleanup = () => {
      script.remove();
      delete window[callbackName];
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('The matchmaking lobby did not respond.'));
    }, 10_000);

    window[callbackName] = (response) => {
      window.clearTimeout(timeout);
      cleanup();
      resolve(parseSheetResponse(response));
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      cleanup();
      reject(new Error('Could not read the matchmaking lobby.'));
    };
    script.src = url.href;
    document.head.append(script);
  });
}

async function makeOffer(waitingPeer) {
  if (state.mode !== 'waiting') return;

  state.mode = 'offering';
  setStatus('Connecting…', 'neutral');
  const connection = makeConnection();
  state.remotePeerId = waitingPeer.peer;
  const channel = connection.createDataChannel('chat');
  attachChannel(channel);

  const offer = await connection.createOffer();
  await connection.setLocalDescription(offer);
  await waitForIceGathering(connection);
  if (connection !== state.connection) return;

  await postSignal('offer', waitingPeer.peer, JSON.stringify(connection.localDescription));
  state.handshakeDeadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
}

async function answerOffer(signal) {
  if (state.mode !== 'waiting') return;

  let offer;
  try {
    offer = JSON.parse(signal.payload);
  } catch {
    return;
  }
  if (offer.type !== 'offer' || !offer.sdp) return;

  state.mode = 'answering';
  setStatus('Connecting…', 'neutral');
  const connection = makeConnection();
  state.remotePeerId = signal.peer;

  await connection.setRemoteDescription(offer);
  const answer = await connection.createAnswer();
  await connection.setLocalDescription(answer);
  await waitForIceGathering(connection);
  if (connection !== state.connection) return;
  await postSignal('answer', signal.peer, JSON.stringify(connection.localDescription));
  state.handshakeDeadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
}

async function postPresence() {
  state.lastPresencePostAt = Date.now();
  const target = state.mode === 'connected' ? busyTarget(state.remotePeerId) : lobby();
  await postSignal('waiting', target);
}

async function joinQueue() {
  if (state.mode === 'idle') return;
  stopConnection();
  state.mode = 'waiting';
  state.handshakeDeadline = 0;
  setStatus(
    state.roomCode ? 'Waiting for your friend to join…' : 'Looking for someone to talk to…',
    'neutral'
  );
  setControls();
  await postPresence();
}

async function leavePartner() {
  if (state.remotePeerId) await postSignal('bye', state.remotePeerId);
}

async function poll() {
  if (state.pollInFlight) return;
  const idle = state.mode === 'idle';
  if (idle && (document.hidden || Date.now() - state.lastPollAt < IDLE_PRESENCE_INTERVAL_MS)) {
    return;
  }
  state.pollInFlight = true;
  state.lastPollAt = Date.now();

  try {
    const signals = await readSignals();
    renderPresence(signals);
    if (state.mode === 'idle') return;

    const latest = latestSignalsByPeer(signals);
    const heartbeatDue = Date.now() - state.lastPresencePostAt > PRESENCE_HEARTBEAT_MS;

    if (state.remotePeerId) {
      const partnerSignal = latest.get(state.remotePeerId);
      const left =
        state.mode === 'connected'
          ? partnerHasLeft(partnerSignal, state.peerId)
          : partnerSignal?.kind === 'bye' && partnerSignal.target === state.peerId;
      if (left) {
        setStatus(
          state.roomCode
            ? 'Your friend left. Waiting in your room…'
            : 'They moved on. Finding someone new…'
        );
        await joinQueue();
        return;
      }
    }

    if (state.mode === 'connected') {
      if (heartbeatDue) await postPresence();
      return;
    }

    if (state.mode === 'waiting') {
      const offer = [...latest.values()]
        .filter((signal) => signal.kind === 'offer' && signal.target === state.peerId)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      if (offer) {
        await answerOffer(offer);
        return;
      }

      const peer = findWaitingPeer(signals, state.peerId, { lobby: lobby() });
      if (peer) {
        await makeOffer(peer);
      } else if (heartbeatDue) {
        await postPresence();
      }
      return;
    }

    if (state.mode === 'offering' && state.connection?.signalingState === 'have-local-offer') {
      const answer = latest.get(state.remotePeerId);
      if (answer?.kind === 'answer' && answer.target === state.peerId) {
        try {
          const description = JSON.parse(answer.payload);
          if (description.type !== 'answer' || !description.sdp) throw new Error('Bad answer');
          await state.connection.setRemoteDescription(description);
          state.handshakeDeadline = Date.now() + HANDSHAKE_TIMEOUT_MS;
        } catch {
          await joinQueue();
          return;
        }
      }
    }

    if (
      ['offering', 'answering'].includes(state.mode) &&
      state.handshakeDeadline &&
      Date.now() > state.handshakeDeadline
    ) {
      setStatus('That connection did not go through. Trying again…', 'neutral');
      await joinQueue();
    }
  } catch (error) {
    setStatus(error.message || 'Matchmaking is temporarily unavailable.', 'error');
  } finally {
    state.pollInFlight = false;
  }
}

function pollNow() {
  state.lastPollAt = 0;
  return poll();
}

function abandonHostedRoom() {
  if (!state.hosting) return;
  state.hosting = false;
  setRoom('');
  inviteButton.textContent = 'Invite a friend';
}

async function start() {
  if (state.starting) return;
  if (!ageConfirmed()) {
    setStatus('Confirm that you are 18 or older to start.', 'error');
    abandonHostedRoom();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    setStatus('This browser does not support camera or peer-to-peer video chat.', 'error');
    abandonHostedRoom();
    return;
  }

  state.starting = true;
  startButton.disabled = true;
  try {
    await getLocalMedia();
    state.mode = 'waiting';
    await joinQueue();
    await pollNow();
  } catch (error) {
    const denied = error.name === 'NotAllowedError';
    setStatus(
      denied ? 'Camera and microphone access are required to connect.' : error.message,
      'error'
    );
    state.mode = 'idle';
    abandonHostedRoom();
  } finally {
    state.starting = false;
    startButton.disabled = false;
    setControls();
  }
}

async function switchLobby(roomCode) {
  const active = state.mode !== 'idle';
  if (active) await leavePartner();
  setRoom(roomCode);
  if (active) await joinQueue();
  await pollNow();
}

async function next() {
  await leavePartner();
  await joinQueue();
  await pollNow();
}

async function stop() {
  const partnerId = state.remotePeerId;
  state.mode = 'idle';
  state.handshakeDeadline = 0;
  stopConnection();
  state.localStream?.getTracks().forEach((track) => track.stop());
  state.localStream = null;
  localVideo.srcObject = null;
  localVideo.closest('.video-card').classList.remove('has-video');
  if (partnerId) await postSignal('bye', partnerId);
  if (state.hosting) {
    state.hosting = false;
    setRoom('');
  }
  setStatus(
    state.roomCode ? 'A friend invited you. Join when you are ready.' : 'Ready when you are'
  );
  inviteButton.textContent = 'Invite a friend';
  setControls();
  await pollNow();
}

function showLinkCopied() {
  inviteButton.textContent = 'Link copied';
  window.setTimeout(() => {
    if (inviteButton.textContent === 'Link copied') inviteButton.textContent = 'Invite a friend';
  }, 2_000);
}

async function copyInviteLink(roomCode) {
  const url = inviteUrl(roomCode);
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const field = document.createElement('textarea');
    field.value = url;
    document.body.append(field);
    field.select();
    document.execCommand('copy');
    field.remove();
  }
  showLinkCopied();
}

startButton.addEventListener('click', () => void start());
nextButton.addEventListener('click', () => void next());
stopButton.addEventListener('click', () => void stop());

inviteButton.addEventListener('click', () => {
  if (state.hosting) {
    void copyInviteLink(state.roomCode);
    return;
  }
  if (!ageConfirmed()) {
    setStatus('Confirm that you are 18 or older to start.', 'error');
    return;
  }

  const roomCode = createRoomCode();
  state.hosting = true;
  void copyInviteLink(roomCode);
  if (state.mode === 'idle') {
    setRoom(roomCode);
    void start();
  } else {
    void switchLobby(roomCode);
  }
});

muteButton.addEventListener('click', () => {
  const track = state.localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteButton.textContent = track.enabled ? 'Mute' : 'Unmute';
});

cameraButton.addEventListener('click', () => {
  const track = state.localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  cameraButton.textContent = track.enabled ? 'Camera off' : 'Camera on';
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || state.channel?.readyState !== 'open') return;
  state.channel.send(message);
  addMessage(message, 'outgoing');
  chatInput.value = '';
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.mode === 'idle') void pollNow();
});

window.addEventListener('pagehide', () => {
  if (state.mode === 'idle') return;
  navigator.sendBeacon(
    FORM_URL,
    formBody({ peer: state.peerId, kind: 'bye', target: state.remotePeerId ?? '' })
  );
  state.localStream?.getTracks().forEach((track) => track.stop());
});

try {
  ageConfirm.checked = localStorage.getItem(AGE_STORAGE_KEY) === 'yes';
} catch {
  ageConfirm.checked = false;
}
ageConfirm.addEventListener('change', () => {
  try {
    if (ageConfirm.checked) localStorage.setItem(AGE_STORAGE_KEY, 'yes');
    else localStorage.removeItem(AGE_STORAGE_KEY);
  } catch {
    // Private browsing can block storage; the checkbox still gates this visit.
  }
  setControls();
});

setControls();
if (state.roomCode) setStatus('A friend invited you. Join when you are ready.');
state.pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
void pollNow();
