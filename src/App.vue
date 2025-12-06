<template>
  <div class="lobby-shell">
    <div
      class="scene"
      ref="sceneRef"
      :class="{ 'is-engaged': isStageEngaged }"
      :style="sceneStyle"
      @click="handleStageClick"
    >
      <img
        class="scene-bg"
        :src="backgroundImage"
        alt="NavTalk lobby background"
        loading="lazy"
      />
      <div class="lobby-vignette" />

      <header class="lobby-header" @click.stop>
        <div class="brand-mark">
          <a class="brand-link" href="https://navtalk.ai/" target="_blank" rel="noreferrer">
            <span class="brand-icon" :style="brandIconStyle" aria-hidden="true" />
            <span class="brand-text">NavTalk</span>
          </a>
        </div>
        <button class="github-link" type="button" @click.stop="openGithub">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h14m0 0-5-5m5 5-5 5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>GitHub</span>
        </button>
      </header>

      <div class="digital-frame" :style="frameStyle">
        <div v-if="isConnecting" class="frame-loading">
          <div class="loading-ring">
            <span />
          </div>
          <p>Connecting…</p>
        </div>
        <video ref="videoRef" autoplay playsinline class="kiosk-video" />
        <img
          v-if="!isVideoStreaming"
          class="kiosk-poster"
          :src="heroPoster"
          alt="NavTalk digital receptionist"
        />
      </div>

      <div
        class="frame-dial"
        :class="{ 'is-active': isCallActive || isConnecting }"
        :style="dialStyle"
      />
      
      <div class="start-hint" :style="hintStyle">Click anywhere to begin</div>

      <footer class="lobby-footer" @click.stop>
        <span>© 2025 NavTalk. All rights reserved.</span>
        <nav>
          <a
            v-for="link in socialLinks"
            :key="link.label"
            :href="link.url"
            target="_blank"
            rel="noreferrer"
          >
            {{ link.label }}
          </a>
        </nav>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useNavTalkRealtime } from './composables/useNavTalkRealtime'

const ORIGINAL_WIDTH = 4096
const ORIGINAL_HEIGHT = 2300
const FRAME_BOUNDS = { x: 1910, y: 857, width: 320, height: 598 }
const FRAME_CENTER_RATIO = {
  x: (FRAME_BOUNDS.x + FRAME_BOUNDS.width / 2) / ORIGINAL_WIDTH,
  y: (FRAME_BOUNDS.y + FRAME_BOUNDS.height / 2) / ORIGINAL_HEIGHT,
}
const ENGAGED_VERTICAL_SHIFT = -0.04
const BG_ORIGIN_X = `${FRAME_CENTER_RATIO.x * 100}%`
const BG_ORIGIN_Y = `${FRAME_CENTER_RATIO.y * 100}%`
const DIAL_RATIO = { cx: 0.5, cy: 0.86, size: 0.32 }
const HINT_RATIO = { width: 1, height: 0.08, gap: 0.3, minHeight: 32 }
const HINT_TEXT = 'Click anywhere to begin'

const videoRef = ref<HTMLVideoElement | null>(null)
const sceneRef = ref<HTMLDivElement | null>(null)
const assetBase = import.meta.env.BASE_URL ?? '/'
const heroPoster = `${assetBase}images/avter.png`
const backgroundImage = `${assetBase}images/lobby-bg.png`
const brandIconStyle = { backgroundImage: `url(${assetBase}images/navtalk.png)` }

const { isCallActive, isConnecting, isVideoStreaming, toggleSession } = useNavTalkRealtime(videoRef)
const isStageEngaged = ref(false)
const frameScale = ref(1)
const backgroundShift = ref(0)

const frameStyle = ref<Record<string, string>>({})
const hintStyle = ref<Record<string, string>>({})
const dialStyle = ref<Record<string, string>>({})
const sceneStyle = computed(() => ({
  '--bg-scale': frameScale.value.toString(),
  '--bg-origin-x': BG_ORIGIN_X,
  '--bg-origin-y': BG_ORIGIN_Y,
  '--bg-shift': `${backgroundShift.value}px`,
}))

const socialLinks = [
  { label: 'YouTube', url: 'https://www.youtube.com/@frankfu007' },
  { label: 'Discord', url: 'https://discord.com/invite/A9VE3zXM9p' },
  { label: 'X', url: 'https://x.com/NavTalkAI' },
  { label: 'Facebook', url: 'https://www.facebook.com/61583493046839/' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com/in/navbot-frank/' },
]

function computeCoverLayout(container: DOMRect) {
  const containerRatio = container.width / container.height
  const imageRatio = ORIGINAL_WIDTH / ORIGINAL_HEIGHT
  let displayWidth: number
  let displayHeight: number
  let offsetX = 0
  let offsetY = 0

  if (containerRatio > imageRatio) {
    displayWidth = container.width
    displayHeight = container.width / imageRatio
    offsetY = (container.height - displayHeight) / 2
  } else {
    displayHeight = container.height
    displayWidth = container.height * imageRatio
    offsetX = (container.width - displayWidth) / 2
  }

  const scale = displayWidth / ORIGINAL_WIDTH
  return { scale, offsetX, offsetY, displayWidth, displayHeight }
}

function updateOverlayPositions() {
  const scene = sceneRef.value
  if (!scene) return
  const rect = scene.getBoundingClientRect()
  const { scale, offsetX, offsetY } = computeCoverLayout(rect)

  const baseFrameWidth = FRAME_BOUNDS.width * scale
  const baseFrameHeight = FRAME_BOUNDS.height * scale
  const baseCenterX = offsetX + (FRAME_BOUNDS.x + FRAME_BOUNDS.width / 2) * scale
  const baseCenterY = offsetY + (FRAME_BOUNDS.y + FRAME_BOUNDS.height / 2) * scale

  let frameWidth = baseFrameWidth
  let frameHeight = baseFrameHeight
  let frameX = baseCenterX - frameWidth / 2
  let frameY = baseCenterY - frameHeight / 2
  let scaleMultiplier = 1

  if (isStageEngaged.value) {
    const targetHeight = rect.height * 0.7
    scaleMultiplier = Math.max(targetHeight / baseFrameHeight, 1)
    frameWidth = baseFrameWidth * scaleMultiplier
    frameHeight = baseFrameHeight * scaleMultiplier
    frameX = baseCenterX - frameWidth / 2
    frameY = baseCenterY - frameHeight / 2
    frameY += rect.height * ENGAGED_VERTICAL_SHIFT
    const maxX = rect.width - frameWidth
    const maxY = rect.height - frameHeight
    frameX = Math.min(Math.max(frameX, 0), Math.max(maxX, 0))
    frameY = Math.min(Math.max(frameY, 0), Math.max(maxY, 0))
    backgroundShift.value = frameY + frameHeight / 2 - baseCenterY
  } else {
    backgroundShift.value = 0
  }
  frameScale.value = scaleMultiplier

  frameStyle.value = {
    width: `${frameWidth}px`,
    height: `${frameHeight}px`,
    transform: `translate(${frameX}px, ${frameY}px)`,
  }

  const dialSize = frameWidth * DIAL_RATIO.size
  dialStyle.value = {
    width: `${dialSize}px`,
    height: `${dialSize}px`,
    transform: `translate(${frameX + frameWidth * DIAL_RATIO.cx - dialSize / 2}px, ${
      frameY + frameHeight * DIAL_RATIO.cy - dialSize / 2
    }px)`,
  }

  const hintWidth = frameWidth * HINT_RATIO.width
  const hintHeight = Math.max(frameHeight * HINT_RATIO.height, HINT_RATIO.minHeight)
  const horizontalPadding = 48
  const availableWidth = Math.max(hintWidth - horizontalPadding, 16)
  const fontSizeByHeight = hintHeight * 0.45
  const fontSizeByWidth = availableWidth / (HINT_TEXT.length * 0.6)
  const hintFontSize = Math.min(fontSizeByHeight, fontSizeByWidth)
  hintStyle.value = {
    width: `${hintWidth}px`,
    height: `${hintHeight}px`,
    transform: `translate(${frameX + frameWidth / 2 - hintWidth / 2}px, ${
      frameY + frameHeight + frameHeight * HINT_RATIO.gap
    }px)`,
    fontSize: `${hintFontSize}px`,
    lineHeight: `${hintHeight}px`,
  }
}

let resizeObserver: ResizeObserver | null = null

watch(
  [isCallActive, isConnecting],
  ([active, connecting]) => {
    if (active || connecting) {
      isStageEngaged.value = true
    } else {
      isStageEngaged.value = false
    }
  },
  { immediate: true }
)

watch(isStageEngaged, () => {
  updateOverlayPositions()
})

onMounted(() => {
  updateOverlayPositions()
  resizeObserver = new ResizeObserver(() => updateOverlayPositions())
  if (sceneRef.value) {
    resizeObserver.observe(sceneRef.value)
  }
  window.addEventListener('resize', updateOverlayPositions)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateOverlayPositions)
})

function handleStageClick() {
  if (isConnecting.value) {
    return
  }
  if (!isCallActive.value) {
    isStageEngaged.value = true
    toggleSession()
    return
  }
  toggleSession()
}

function openGithub() {
  window.open('https://github.com/navtalk/Hotel-Front-Desk-Receptionist', '_blank')
}
</script>
