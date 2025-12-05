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
const DEFAULT_PROMPT = `NavTalk.ai – Hotel Front Desk Assistant (System Prompt)
Role & Context You are “Jane”, a friendly, highly professional AI Hotel Front Desk Assistant running on a NavTalk.ai kiosk in the hotel lobby. You help guests with:
• Check-in
• General enquiries
• Hotel information & local recommendations
• Check-out
You always speak in a warm, concise, and polite tone, like a 5-star hotel receptionist.

Core Behaviour
1. Greeting & Identification
Always start with a friendly greeting and a short question to know what the guest needs.
Example:
“Good afternoon, welcome to [Hotel Name]. I’m Jane, your virtual front desk assistant. Are you checking in, checking out, or do you have a question I can help with?”

2. Check-In Flow
When the guest says they want to check in, guide them step by step:
• Ask for full name, booking reference, check-in date, number of nights
• Confirm details back to the guest
• Ask for number of guests, email address, payment method/card for incidentals
• Give clear next steps and narrate what is happening (“Thank you, I’m just confirming your reservation now.”)
• Once confirmed, explain room / floor, Wi-Fi, breakfast time & location, and how to collect the room key.

3. Guest Enquiries
You can answer questions about hotel facilities, services, local area tips, and simple troubleshooting (Wi-Fi, key cards, towels). Keep answers short and clear, offer to repeat or simplify, and hand off to a human colleague if needed.

4. Check-Out Flow
Ask for full name (and room number if allowed), confirm check-out date and outstanding charges, then offer email/printed receipts, luggage storage, taxi arrangements, and close warmly.

5. Tone & Style
Warm, calm, professional, short responses (1–3 sentences), use the guest’s name, clarify if unsure.

6. Safety & Privacy
Do not say room numbers aloud if policy requires privacy, never share one guest’s details with another, and escalate suspicious requests to a human colleague.

7. Escalation
For complex issues (complaints, refunds, lost valuables, emergencies) respond with empathy and hand over to staff at the desk.

Example Opening
“Hello and welcome to [Hotel Name]. I’m Jane, your virtual front desk assistant. Are you checking in, checking out, or do you have a question?”`

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

  const isConfigured = computed(() => Boolean(config.license))
  const isCallActive = computed(() => sessionStatus.value === 'connected')
  const isConnecting = computed(() => sessionStatus.value === 'connecting')

  const assistantSegments = new Map<string, string>()
  const functionCallBuffers = new Map<string, string>()
  const AUTO_HANGUP_DELAY = 5000
  let realtimeSocket: WebSocket | null = null
  let signalingSocket: WebSocket | null = null
  let peerConnection: RTCPeerConnection | null = null
  let audioContext: AudioContext | null = null
  let audioProcessor: ScriptProcessorNode | null = null
  let audioStream: MediaStream | null = null
  let proxySessionId: string | null = null
  let targetSessionId: string | null = null
  let hasHydratedIceServers = false
  let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  let pendingUserMessageId: string | null = null
  let pendingHangupReason: string | null = null
  let hangupTimer: ReturnType<typeof setTimeout> | null = null

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
    pendingUserMessageId = appendMessage('user', '倾听中…', { streaming: true })
  }

  function resolveUserPlaceholder(transcript: string) {
    if (!pendingUserMessageId) return
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

  async function ensureIceServers() {
    if (hasHydratedIceServers) return
    try {
      const response = await fetch(`https://${config.baseUrl}/api/webrtc/generate-ice-servers`, {
        method: 'POST',
      })
      const payload = await response.json()
      if (payload?.code === 200 && Array.isArray(payload?.data?.iceServers)) {
        iceServers = payload.data.iceServers
        hasHydratedIceServers = true
      }
    } catch (err) {
      console.warn('Unable to refresh ICE servers, falling back to default.', err)
      hasHydratedIceServers = true
    }
  }

  async function handleOffer(message: any) {
    await ensureIceServers()
    if (peerConnection) {
      peerConnection.close()
    }
    peerConnection = new RTCPeerConnection({ iceServers })

    peerConnection.ontrack = (event) => {
      const video = videoElement.value
      if (!video) return
      video.srcObject = event.streams[0]
      video.muted = false
      video
        .play()
        .then(() => {
          video.classList.add('is-streaming')
        })
        .catch(() => {
          // Autoplay may fail silently; user will start the video via UI
        })
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && signalingSocket && targetSessionId) {
        signalingSocket.send(
          JSON.stringify({
            type: 'iceCandidate',
            targetSessionId: targetSessionId,
            candidate: event.candidate,
          })
        )
      }
    }

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return
      if (peerConnection.connectionState === 'failed') {
        peerConnection.restartIce()
      }
    }

    const remoteDesc = new RTCSessionDescription(message.sdp)
    await peerConnection.setRemoteDescription(remoteDesc)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    if (signalingSocket) {
      signalingSocket.send(
        JSON.stringify({
          type: 'answer',
          targetSessionId: message.targetSessionId,
          sdp: peerConnection.localDescription,
        })
      )
    }
  }

  function handleIceCandidate(message: any) {
    if (!peerConnection) return
    const candidate = new RTCIceCandidate(message.candidate)
    peerConnection
      .addIceCandidate(candidate)
      .catch((err) => console.error('ICE candidate error', err))
  }

  function setupSignalingSocket() {
    if (!proxySessionId || signalingSocket) {
      return
    }

    targetSessionId = `target-${proxySessionId}`
    const url = new URL(`wss://${config.baseUrl}/api/webrtc`)
    url.searchParams.set('userId', proxySessionId)
    signalingSocket = new WebSocket(url)

    signalingSocket.onopen = () => {
      if (!signalingSocket || !targetSessionId) return
      signalingSocket.send(JSON.stringify({ type: 'create', targetSessionId }))
    }

    signalingSocket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.type === 'offer') {
          handleOffer(payload)
        } else if (payload.type === 'iceCandidate') {
          handleIceCandidate(payload)
        }
      } catch (error) {
        console.error('Failed to parse signaling message', error)
      }
    }

    signalingSocket.onerror = (event) => {
      console.error('Signaling socket error', event)
    }

    signalingSocket.onclose = () => {
      signalingSocket = null
      targetSessionId = null
    }
  }

  async function sendSessionUpdate() {
    if (!realtimeSocket) return
    const payload = {
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
    realtimeSocket.send(JSON.stringify(payload))

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

  async function startRecording() {
    if (audioStream || typeof navigator === 'undefined') {
      return
    }

    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      audioContext = new AudioCtx({ sampleRate: 24000 })
      const source = audioContext.createMediaStreamSource(audioStream)
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
          realtimeSocket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk }))
        }
      }
      source.connect(audioProcessor)
      audioProcessor.connect(audioContext.destination)
    } catch (error) {
      console.error('Microphone permission denied', error)
      handleError('无法访问麦克风，请检查浏览器权限。')
    }
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
    if (!video) return
    video.pause()
    video.removeAttribute('src')
    video.srcObject = null
    video.load()
    video.classList.remove('is-streaming')
  }

  function teardown(nextStatus: SessionStatus, reason?: string) {
    stopRecording()
    if (realtimeSocket) {
      realtimeSocket.onclose = null
      realtimeSocket.onerror = null
      realtimeSocket.onmessage = null
      realtimeSocket.close()
      realtimeSocket = null
    }
    if (signalingSocket) {
      signalingSocket.onclose = null
      signalingSocket.close()
      signalingSocket = null
    }
    if (peerConnection) {
      peerConnection.ontrack = null
      peerConnection.close()
      peerConnection = null
    }
    clearVideoElement()
    proxySessionId = null
    targetSessionId = null
    hasHydratedIceServers = false
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
    }
    sessionStatus.value = nextStatus
  }

  function handleError(message: string) {
    teardown('error', message)
  }

  function disconnect() {
    teardown('idle')
  }

  async function connect() {
    if (!isConfigured.value) {
      errorMessage.value = '请在 .env 中配置 NavTalk License。'
      return
    }
    if (sessionStatus.value === 'connecting' || sessionStatus.value === 'connected') {
      return
    }
    errorMessage.value = ''
    sessionStatus.value = 'connecting'
    assistantSegments.clear()
    pendingUserMessageId = null

    const url = new URL(`wss://${config.baseUrl}/api/realtime-api`)
    url.searchParams.set('license', config.license)
    url.searchParams.set('characterName', config.characterName)
    url.searchParams.set('model', config.model)

    try {
      realtimeSocket = new WebSocket(url)
      realtimeSocket.binaryType = 'arraybuffer'

      realtimeSocket.onopen = () => {
        console.info('Realtime socket connected')
      }

      realtimeSocket.onmessage = (event) => {
        if (typeof event.data !== 'string') {
          return
        }
        try {
          const data = JSON.parse(event.data)
          switch (data.type) {
            case 'session.created':
              sendSessionUpdate()
              break
            case 'session.updated':
              sessionStatus.value = 'connected'
              startRecording()
              break
            case 'session.session_id': {
              const sessionId = data.sessionId ?? data.session_id
              if (sessionId && sessionId !== proxySessionId) {
                proxySessionId = sessionId
                setupSignalingSocket()
              }
              break
            }
            case 'input_audio_buffer.speech_started':
              userSpeaking.value = true
              handleUserPlaceholder()
              break
            case 'input_audio_buffer.speech_stopped':
              userSpeaking.value = false
              break
            case 'conversation.item.input_audio_transcription.completed':
              resolveUserPlaceholder(data.transcript ?? '')
              break
            case 'response.audio_transcript.delta':
              handleAssistantDelta(data.response_id, data.delta ?? '')
              break
            case 'response.audio_transcript.done':
              finalizeAssistantResponse(data.response_id)
              break
            case 'response.completed':
              assistantThinking.value = false
              attemptAutoHangup()
              break
            case 'response.audio.done':
              assistantThinking.value = false
              attemptAutoHangup()
              break
            case 'response.function_call_arguments.delta':
              handleFunctionCallDelta(data)
              break
            case 'response.function_call_arguments.done':
              handleFunctionCallDone(data)
              break
            case 'error':
            case 'response.error':
              handleError(data.error?.message ?? 'NavTalk 实时服务报错')
              break
            default:
              break
          }
        } catch (err) {
          console.error('Failed to parse realtime payload', err)
        }
      }

      realtimeSocket.onerror = () => {
        handleError('实时通道出现异常，请稍后再试。')
      }

      realtimeSocket.onclose = () => {
        if (sessionStatus.value === 'connected') {
          teardown('idle', '会话已关闭。')
        } else {
          teardown('idle')
        }
      }
    } catch (error) {
      console.error('Unable to start realtime session', error)
      handleError('无法连接到 NavTalk 服务。')
    }
  }

  async function sendTextMessage() {
    const text = manualMessage.value.trim()
    if (!text) return
    if (!realtimeSocket || realtimeSocket.readyState !== WebSocket.OPEN) {
      errorMessage.value = '当前未连接到 NavTalk，无法发送消息。'
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

  function toggleSession() {
    if (isCallActive.value || isConnecting.value) {
      disconnect()
    } else {
      connect()
    }
  }

  function clearHistory() {
    chatMessages.value = []
    saveHistory([])
  }

  function handleFunctionCallDelta(event: any) {
    if (!event?.call_id || typeof event.delta !== 'string') {
      return
    }
    const callId = String(event.call_id)
    functionCallBuffers.set(callId, `${functionCallBuffers.get(callId) ?? ''}${event.delta}`)
  }

  function handleFunctionCallDone(event: any) {
    const name = typeof event?.name === 'string' ? event.name : ''
    const callId = event?.call_id ? String(event.call_id) : undefined

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

  onBeforeUnmount(() => {
    disconnect()
  })

  return {
    chatMessages,
    sessionStatus,
    assistantThinking,
    userSpeaking,
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
