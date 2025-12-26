import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue'

export type ChatRole = 'user' | 'assistant'
export type SessionStatus = 'idle' | 'connecting' | 'connected' | 'error'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  streaming?: boolean
  timestamp: number
}

interface NavTalkConfig {
  license: string
  model: string
  characterName: string
  voice: string
  prompt: string
  baseUrl: string
}

const HISTORY_KEY = 'hotel-navtalk-history'
const DEFAULT_PROMPT = `NavTalk.ai 每 Hotel Front Desk Assistant (System Prompt)
Role & Context You are ※Jane§, a friendly, highly professional AI Hotel Front Desk Assistant running on a NavTalk.ai kiosk in the hotel lobby. You help guests with:
? Check-in
? General enquiries
? Hotel information & local recommendations
? Check-out
You always speak in a warm, concise, and polite tone, like a 5-star hotel receptionist.

Core Behaviour
1. Greeting & Identification
Always start with a friendly greeting and a short question to know what the guest needs.
Example:
※Good afternoon, welcome to [Hotel Name]. I＊m Jane, your virtual front desk assistant. Are you checking in, checking out, or do you have a question I can help with?§

2. Check-In Flow
When the guest says they want to check in, guide them step by step:
? Ask for full name, booking reference, check-in date, number of nights
? Confirm details back to the guest
? Ask for number of guests, email address, payment method/card for incidentals
? Give clear next steps and narrate what is happening (※Thank you, I＊m just confirming your reservation now.§)
? Once confirmed, explain room / floor, Wi-Fi, breakfast time & location, and how to collect the room key.

3. Guest Enquiries
You can answer questions about hotel facilities, services, local area tips, and simple troubleshooting (Wi-Fi, key cards, towels). Keep answers short and clear, offer to repeat or simplify, and hand off to a human colleague if needed.

4. Check-Out Flow
Ask for full name (and room number if allowed), confirm check-out date and outstanding charges, then offer email/printed receipts, luggage storage, taxi arrangements, and close warmly.

5. Tone & Style
Warm, calm, professional, short responses (1每3 sentences), use the guest＊s name, clarify if unsure.

6. Safety & Privacy
Do not say room numbers aloud if policy requires privacy, never share one guest＊s details with another, and escalate suspicious requests to a human colleague.

7. Escalation
For complex issues (complaints, refunds, lost valuables, emergencies) respond with empathy and hand over to staff at the desk.

Example Opening
※Hello and welcome to [Hotel Name]. I＊m Jane, your virtual front desk assistant. Are you checking in, checking out, or do you have a question?§`
const AUTO_HANGUP_DELAY = 5000
const NavTalkMessageType = Object.freeze({
  CONNECTED_SUCCESS: 'conversation.connected.success',
  CONNECTED_FAIL: 'conversation.connected.fail',
  CONNECTED_CLOSE: 'conversation.connected.close',
  INSUFFICIENT_BALANCE: 'conversation.connected.insufficient_balance',
  WEB_RTC_OFFER: 'webrtc.signaling.offer',
  WEB_RTC_ANSWER: 'webrtc.signaling.answer',
  WEB_RTC_ICE_CANDIDATE: 'webrtc.signaling.iceCandidate',
  REALTIME_SESSION_CREATED: 'realtime.session.created',
  REALTIME_SESSION_UPDATED: 'realtime.session.updated',
  REALTIME_SPEECH_STARTED: 'realtime.input_audio_buffer.speech_started',
  REALTIME_SPEECH_STOPPED: 'realtime.input_audio_buffer.speech_stopped',
  REALTIME_CONVERSATION_ITEM_COMPLETED:
    'realtime.conversation.item.input_audio_transcription.completed',
  REALTIME_RESPONSE_AUDIO_TRANSCRIPT_DELTA: 'realtime.response.audio_transcript.delta',
  REALTIME_RESPONSE_AUDIO_DELTA: 'realtime.response.audio.delta',
  REALTIME_RESPONSE_AUDIO_TRANSCRIPT_DONE: 'realtime.response.audio_transcript.done',
  REALTIME_RESPONSE_AUDIO_DONE: 'realtime.response.audio.done',
  REALTIME_RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE:
    'realtime.response.function_call_arguments.done',
  REALTIME_RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA:
    'realtime.response.function_call_arguments.delta',
  REALTIME_INPUT_AUDIO_BUFFER_APPEND: 'realtime.input_audio_buffer.append',
  REALTIME_INPUT_TEXT: 'realtime.input_text',
  REALTIME_INPUT_IMAGE: 'realtime.input_image',
  UNKNOWN_TYPE: 'unknow',
} as const)

function loadHistory(): ChatMessage[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveHistory(messages: ChatMessage[]) {
  if (typeof window === 'undefined') {
    return
  }
  const trimmed = messages.slice(-40)
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function floatTo16BitPCM(float32Array: Float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2)
  const view = new DataView(buffer)
  let offset = 0
  for (let i = 0; i < float32Array.length; i += 1, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
}

function base64Encode(uint8Array: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < uint8Array.length; i += chunk) {
    const segment = uint8Array.subarray(i, i + chunk)
    binary += String.fromCharCode(...segment)
  }
  return btoa(binary)
}

export function useNavTalkRealtime(videoElement: Ref<HTMLVideoElement | null>) {
  const config = reactive<NavTalkConfig>({
    license: import.meta.env.VITE_NAVTALK_LICENSE ?? '',
    model: import.meta.env.VITE_NAVTALK_MODEL ?? 'gpt-realtime',
    characterName: import.meta.env.VITE_NAVTALK_CHARACTER ?? 'navtalk.Brain',
    voice: import.meta.env.VITE_NAVTALK_VOICE ?? 'cedar',
    prompt: import.meta.env.VITE_NAVTALK_PROMPT ?? DEFAULT_PROMPT,
    baseUrl: import.meta.env.VITE_NAVTALK_BASE_URL ?? 'transfer.navtalk.ai',
  })

  const chatMessages = ref<ChatMessage[]>(loadHistory())
  const sessionStatus = ref<SessionStatus>('idle')
  const assistantThinking = ref(false)
  const userSpeaking = ref(false)
  const errorMessage = ref('')
  const manualMessage = ref('')
  const isVideoStreaming = ref(false)

  const isConfigured = computed(() => Boolean(config.license))
  const isCallActive = computed(() => sessionStatus.value === 'connected')
  const isConnecting = computed(() => sessionStatus.value === 'connecting')

  const assistantSegments = new Map<string, string>()
  const functionCallBuffers = new Map<string, string>()
  let realtimeSocket: WebSocket | null = null
  let peerConnection: RTCPeerConnection | null = null
  let audioContext: AudioContext | null = null
  let audioProcessor: ScriptProcessorNode | null = null
  let audioStream: MediaStream | null = null
  let pendingUserMessageId: string | null = null
  let pendingHangupReason: string | null = null
  let hangupTimer: ReturnType<typeof setTimeout> | null = null
  let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]

  watch(
    chatMessages,
    (messages) => {
      saveHistory(messages)
    },
    { deep: true }
  )

  function appendMessage(role: ChatRole, text: string, opts?: { streaming?: boolean; id?: string }) {
    const id = opts?.id ?? createId(role)
    chatMessages.value.push({
      id,
      role,
      text,
      streaming: opts?.streaming ?? false,
      timestamp: Date.now(),
    })
    return id
  }

  function updateMessage(id: string, text: string, streaming?: boolean) {
    const index = chatMessages.value.findIndex((msg) => msg.id === id)
    if (index === -1) return
    chatMessages.value[index].text = text
    if (typeof streaming === 'boolean') {
      chatMessages.value[index].streaming = streaming
    }
  }

  function removeMessage(id: string) {
    const index = chatMessages.value.findIndex((msg) => msg.id === id)
    if (index === -1) return
    chatMessages.value.splice(index, 1)
  }

  function handleUserPlaceholder() {
    if (pendingUserMessageId) return
    pendingUserMessageId = appendMessage('user', 'Listening...', { streaming: true })
  }

  function resolveUserPlaceholder(transcript: string) {
    if (!pendingUserMessageId) {
      return
    }
    const trimmed = transcript.trim()
    if (!trimmed) {
      removeMessage(pendingUserMessageId)
    } else {
      updateMessage(pendingUserMessageId, trimmed, false)
    }
    pendingUserMessageId = null
  }

  function handleAssistantDelta(responseId: string, delta: string) {
    assistantThinking.value = true
    const next = `${assistantSegments.get(responseId) ?? ''}${delta}`
    assistantSegments.set(responseId, next)
    const existingIndex = chatMessages.value.findIndex((msg) => msg.id === responseId)
    if (existingIndex === -1) {
      chatMessages.value.push({
        id: responseId,
        role: 'assistant',
        text: next,
        streaming: true,
        timestamp: Date.now(),
      })
    } else {
      chatMessages.value[existingIndex].text = next
      chatMessages.value[existingIndex].streaming = true
    }
  }

  function finalizeAssistantResponse(responseId: string) {
    const index = chatMessages.value.findIndex((msg) => msg.id === responseId)
    if (index !== -1) {
      chatMessages.value[index].streaming = false
    }
    assistantThinking.value = false
  }

  async function sendSessionUpdate() {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    const sessionPayload = {
      type: 'session.update',
      session: {
        instructions: config.prompt,
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
        voice: config.voice,
        temperature: 0.9,
        max_response_output_tokens: 4096,
        modalities: ['text', 'audio'],
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
        },
        tools: [
          {
            type: 'function',
            name: 'end_conversation',
            description:
              'Call this when the guest says goodbye, wants to leave, or asks to end the conversation so the kiosk can hang up automatically.',
            parameters: {
              type: 'object',
              properties: {
                reason: {
                  type: 'string',
                  description: 'Brief explanation of why the call should end.',
                },
              },
              required: ['reason'],
            },
          },
        ],
      },
    }
    realtimeSocket.send(JSON.stringify(sessionPayload))

    const recentUserMessages = chatMessages.value.filter((msg) => msg.role === 'user').slice(-3)
    recentUserMessages.forEach((msg) => {
      realtimeSocket?.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: msg.text,
              },
            ],
          },
        })
      )
    })
  }

  function sendOfferMessage(sdp: RTCSessionDescriptionInit) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    realtimeSocket.send(
      JSON.stringify({
        type: NavTalkMessageType.WEB_RTC_OFFER,
        data: { sdp },
      })
    )
  }

  function sendAnswerMessage(sdp: RTCSessionDescriptionInit) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    realtimeSocket.send(
      JSON.stringify({
        type: NavTalkMessageType.WEB_RTC_ANSWER,
        data: { sdp },
      })
    )
  }

  function sendIceMessage(candidate: RTCIceCandidateInit) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    realtimeSocket.send(
      JSON.stringify({
        type: NavTalkMessageType.WEB_RTC_ICE_CANDIDATE,
        data: { candidate },
      })
    )
  }

  async function handleOffer(message: any) {
    if (!message?.sdp) {
      return
    }
    const offerDescription = new RTCSessionDescription(message.sdp)
    if (peerConnection) {
      peerConnection.ontrack = null
      peerConnection.onicecandidate = null
      peerConnection.onconnectionstatechange = null
      peerConnection.onnegotiationneeded = null
      peerConnection.close()
    }
    peerConnection = new RTCPeerConnection({ iceServers })

    peerConnection.ontrack = (event) => {
      const video = videoElement.value
      if (!video) {
        return
      }
      video.srcObject = event.streams[0]
      video.muted = false
      video
        .play()
        .then(() => {
          video.classList.add('is-streaming')
          isVideoStreaming.value = true
        })
        .catch(() => {
          // autoplay might be blocked
        })
      isVideoStreaming.value = true
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendIceMessage(event.candidate)
      }
    }

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) {
        return
      }
      if (peerConnection.connectionState === 'failed') {
        peerConnection.restartIce()
      }
    }

    peerConnection.onnegotiationneeded = async () => {
      if (!peerConnection) {
        return
      }
      try {
        const renegotiationOffer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(renegotiationOffer)
        sendOfferMessage(renegotiationOffer)
      } catch (error) {
        console.error('Negotiation error', error)
      }
    }

    try {
      await peerConnection.setRemoteDescription(offerDescription)
      const answer = await peerConnection.createAnswer()
      await peerConnection.setLocalDescription(answer)
      sendAnswerMessage(answer)
    } catch (error) {
      console.error('Error handling offer:', error)
    }
  }

  function handleAnswer(message: any) {
    if (!peerConnection || !message?.sdp) {
      return
    }
    const answerDescription = new RTCSessionDescription(message.sdp)
    peerConnection
      .setRemoteDescription(answerDescription)
      .catch((err) => console.error('Failed to handle Answer:', err))
  }

  function handleIceCandidate(message: any) {
    if (!peerConnection || !message?.candidate) {
      return
    }
    const candidate = new RTCIceCandidate(message.candidate)
    peerConnection.addIceCandidate(candidate).catch((err) => console.error('Error adding ICE candidate:', err))
  }

  function handleFunctionCallDelta(event: any) {
    if (!event?.call_id || typeof event.delta !== 'string') {
      return
    }
    const callId = String(event.call_id)
    functionCallBuffers.set(callId, `${functionCallBuffers.get(callId) ?? ''}${event.delta}`)
  }

  function handleFunctionCallDone(event: any) {
    const callId = event?.call_id ? String(event.call_id) : undefined
    const name = typeof event?.name === 'string' ? event.name : ''
    let rawArguments: string | undefined
    if (typeof event?.arguments === 'string' && event.arguments.trim()) {
      rawArguments = event.arguments
    } else if (callId && functionCallBuffers.has(callId)) {
      rawArguments = functionCallBuffers.get(callId)
    }
    if (callId) {
      functionCallBuffers.delete(callId)
    }

    let parsedArgs: Record<string, unknown> = {}
    if (rawArguments) {
      try {
        parsedArgs = JSON.parse(rawArguments)
      } catch (err) {
        console.error('Failed to parse function call arguments', err)
      }
    }

    if (!name) {
      if (callId) {
        sendFunctionCallResult(callId, { status: 'ignored', reason: 'Function name missing.' })
      }
      return
    }

    handleFunctionCallRequest(name, parsedArgs, callId)
  }

  function handleFunctionCallRequest(name: string, args: Record<string, unknown>, callId?: string) {
    switch (name) {
      case 'end_conversation':
        scheduleAutoHangup(args, callId)
        break
      default:
        if (callId) {
          sendFunctionCallResult(callId, { status: 'ignored', reason: `Unhandled function: ${name}` })
        }
    }
  }

  function scheduleAutoHangup(args: Record<string, unknown>, callId?: string) {
    const reasonInput = typeof args?.reason === 'string' ? args.reason.trim() : ''
    const reason = reasonInput || 'Guest requested to end the conversation.'
    pendingHangupReason = reason
    if (hangupTimer) {
      clearTimeout(hangupTimer)
      hangupTimer = null
    }
    if (callId) {
      sendFunctionCallResult(callId, { action: 'end_conversation', status: 'acknowledged', reason })
    }
  }

  function sendFunctionCallResult(callId: string, output: unknown) {
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    const payload = {
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: typeof output === 'string' ? output : JSON.stringify(output),
      },
    }
    realtimeSocket.send(JSON.stringify(payload))
    realtimeSocket.send(JSON.stringify({ type: 'response.create' }))
  }

  function attemptAutoHangup() {
    if (!pendingHangupReason || sessionStatus.value !== 'connected') {
      return
    }
    if (hangupTimer) {
      clearTimeout(hangupTimer)
    }
    const schedule = typeof window === 'undefined' ? setTimeout : window.setTimeout
    hangupTimer = schedule(() => {
      hangupTimer = null
      pendingHangupReason = null
      disconnect()
    }, AUTO_HANGUP_DELAY) as ReturnType<typeof setTimeout>
  }

  function sendAudioMessage(chunk: string) {
    if (!chunk || !realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      return
    }
    realtimeSocket.send(
      JSON.stringify({
        type: NavTalkMessageType.REALTIME_INPUT_AUDIO_BUFFER_APPEND,
        data: { audio: chunk },
      })
    )
  }

  function startRecording() {
    if (audioStream || typeof navigator === 'undefined') {
      return
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
        audioStream = stream
        const source = audioContext.createMediaStreamSource(stream)
        audioProcessor = audioContext.createScriptProcessor(4096, 1, 1)

        audioProcessor.onaudioprocess = (event) => {
          if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
            return
          }
          const inputBuffer = event.inputBuffer.getChannelData(0)
          const pcmBuffer = floatTo16BitPCM(inputBuffer)
          const base64Audio = base64Encode(new Uint8Array(pcmBuffer))
          const chunkSize = 4096
          for (let i = 0; i < base64Audio.length; i += chunkSize) {
            const chunk = base64Audio.slice(i, i + chunkSize)
            sendAudioMessage(chunk)
          }
        }

        source.connect(audioProcessor)
        audioProcessor.connect(audioContext.destination)
      })
      .catch((error) => {
        console.error('Microphone permission denied', error)
        handleError('Unable to access the microphone. Please check browser permissions.')
      })
  }

  function stopRecording() {
    if (audioProcessor) {
      audioProcessor.disconnect()
      audioProcessor.onaudioprocess = null
      audioProcessor = null
    }
    if (audioContext) {
      audioContext.close().catch(() => null)
      audioContext = null
    }
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop())
      audioStream = null
    }
  }

  function clearVideoElement() {
    const video = videoElement.value
    if (!video) {
      return
    }
    video.pause()
    video.removeAttribute('src')
    video.srcObject = null
    video.load()
    video.classList.remove('is-streaming')
    isVideoStreaming.value = false
  }

  async function handleReceivedMessage(raw: unknown) {
    if (typeof raw !== 'string') {
      return
    }
    let payload: any
    try {
      payload = JSON.parse(raw)
    } catch (error) {
      console.error('Failed to parse realtime payload', error)
      return
    }
    const type = payload?.type ?? NavTalkMessageType.UNKNOWN_TYPE
    const data = payload?.data ?? {}
    switch (type) {
      case NavTalkMessageType.CONNECTED_SUCCESS:
        if (Array.isArray(data?.iceServers)) {
          iceServers = data.iceServers
        }
        break
      case NavTalkMessageType.CONNECTED_FAIL:
        handleError(data?.message ?? 'Realtime connection failed.')
        break
      case NavTalkMessageType.CONNECTED_CLOSE:
        teardown('idle', data?.message ?? 'Session closed.')
        break
      case NavTalkMessageType.INSUFFICIENT_BALANCE:
        handleError('You need more points to complete this action.')
        break
      case NavTalkMessageType.REALTIME_SESSION_CREATED:
        await sendSessionUpdate()
        break
      case NavTalkMessageType.REALTIME_SESSION_UPDATED:
        sessionStatus.value = 'connected'
        startRecording()
        break
      case NavTalkMessageType.WEB_RTC_OFFER:
        await handleOffer(data)
        break
      case NavTalkMessageType.WEB_RTC_ANSWER:
        handleAnswer(data)
        break
      case NavTalkMessageType.WEB_RTC_ICE_CANDIDATE:
        handleIceCandidate(data)
        break
      case NavTalkMessageType.REALTIME_SPEECH_STARTED:
        userSpeaking.value = true
        handleUserPlaceholder()
        break
      case NavTalkMessageType.REALTIME_SPEECH_STOPPED:
        userSpeaking.value = false
        break
      case NavTalkMessageType.REALTIME_CONVERSATION_ITEM_COMPLETED: {
        const transcript =
          typeof data?.content === 'string' ? data.content : payload?.transcript ?? ''
        resolveUserPlaceholder(transcript)
        break
      }
      case NavTalkMessageType.REALTIME_RESPONSE_AUDIO_TRANSCRIPT_DELTA: {
        const responseId = data?.id ?? createId('assistant')
        const transcript = typeof data?.content === 'string' ? data.content : ''
        handleAssistantDelta(responseId, transcript)
        break
      }
      case NavTalkMessageType.REALTIME_RESPONSE_AUDIO_TRANSCRIPT_DONE:
        finalizeAssistantResponse(data?.id ?? '')
        break
      case NavTalkMessageType.REALTIME_RESPONSE_AUDIO_DONE:
        assistantThinking.value = false
        attemptAutoHangup()
        break
      case NavTalkMessageType.REALTIME_RESPONSE_FUNCTION_CALL_ARGUMENTS_DONE:
        handleFunctionCallDone(data)
        break
      case NavTalkMessageType.REALTIME_RESPONSE_FUNCTION_CALL_ARGUMENTS_DELTA:
        handleFunctionCallDelta(data)
        break
      case NavTalkMessageType.REALTIME_RESPONSE_AUDIO_DELTA:
        break
      default:
        if (type !== NavTalkMessageType.REALTIME_RESPONSE_AUDIO_DELTA) {
          console.warn('Unhandled event type:', type)
        }
        break
    }
  }

  function handleError(message: string) {
    teardown('error', message)
  }

  function teardown(nextStatus: SessionStatus, reason?: string) {
    stopRecording()
    if (realtimeSocket) {
      realtimeSocket.onclose = null
      realtimeSocket.onerror = null
      realtimeSocket.onmessage = null
      if (realtimeSocket.readyState !== WebSocket.CLOSED) {
        realtimeSocket.close()
      }
      realtimeSocket = null
    }
    if (peerConnection) {
      peerConnection.ontrack = null
      peerConnection.onicecandidate = null
      peerConnection.onconnectionstatechange = null
      peerConnection.onnegotiationneeded = null
      peerConnection.close()
      peerConnection = null
    }
    clearVideoElement()
    assistantSegments.clear()
    functionCallBuffers.clear()
    pendingUserMessageId = null
    pendingHangupReason = null
    if (hangupTimer) {
      clearTimeout(hangupTimer)
      hangupTimer = null
    }
    userSpeaking.value = false
    assistantThinking.value = false
    if (reason) {
      errorMessage.value = reason
    } else if (nextStatus !== 'error') {
      errorMessage.value = ''
    }
    sessionStatus.value = nextStatus
  }

  function connect() {
    if (!isConfigured.value) {
      errorMessage.value = 'Please configure the NavTalk license in your .env file.'
      return
    }
    if (sessionStatus.value === 'connecting' || sessionStatus.value === 'connected') {
      return
    }
    errorMessage.value = ''
    sessionStatus.value = 'connecting'
    assistantSegments.clear()
    pendingUserMessageId = null
    pendingHangupReason = null
    if (hangupTimer) {
      clearTimeout(hangupTimer)
      hangupTimer = null
    }
    iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]

    try {
      const url = new URL(`wss://${config.baseUrl}/wss/v2/realtime-chat`)
      url.searchParams.set('license', config.license)
      url.searchParams.set('name', config.characterName)
      url.searchParams.set('model', config.model)
      realtimeSocket = new WebSocket(url)
      realtimeSocket.binaryType = 'arraybuffer'

      realtimeSocket.onopen = () => {
        console.info('Realtime socket connected')
      }

      realtimeSocket.onmessage = (event) => {
        void handleReceivedMessage(event.data)
      }

      realtimeSocket.onerror = () => {
        handleError('Realtime connection encountered an issue. Please try again.')
      }

      realtimeSocket.onclose = (event) => {
        if (sessionStatus.value === 'connected') {
          teardown('idle', event.reason || 'Session closed.')
        } else {
          teardown('idle')
        }
      }
    } catch (error) {
      console.error('Unable to start realtime session', error)
      handleError('Unable to connect to the NavTalk service.')
    }
  }

  function disconnect() {
    teardown('idle')
  }

  function toggleSession() {
    if (isCallActive.value || isConnecting.value) {
      disconnect()
    } else {
      connect()
    }
  }

  async function sendTextMessage() {
    const text = manualMessage.value.trim()
    if (!text) return
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      errorMessage.value = 'Not connected to NavTalk, unable to send messages.'
      return
    }
    manualMessage.value = ''
    appendMessage('user', text)
    realtimeSocket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      })
    )
    realtimeSocket.send(JSON.stringify({ type: 'response.create' }))
  }

  function clearHistory() {
    chatMessages.value = []
    saveHistory([])
  }

  onBeforeUnmount(() => {
    disconnect()
  })

  return {
    chatMessages,
    sessionStatus,
    assistantThinking,
    userSpeaking,
    isVideoStreaming,
    errorMessage,
    manualMessage,
    isCallActive,
    isConnecting,
    isConfigured,
    connect,
    disconnect,
    toggleSession,
    sendTextMessage,
    clearHistory,
  }
}
