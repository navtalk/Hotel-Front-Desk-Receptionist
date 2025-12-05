<template>
  <div class="lobby-shell">
    <div class="scene" ref="sceneRef" @click="handleStageClick">
      <img
        class="scene-bg"
        :src="backgroundImage"
        alt="NavTalk lobby background"
        loading="lazy"
      />
      <div class="lobby-vignette" />

      <header class="lobby-header" @click.stop>
        <div class="brand-mark">
          <span class="brand-icon" aria-hidden="true" />
          <span class="brand-text">NavTalk</span>
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
        <video ref="videoRef" autoplay playsinline class="kiosk-video" />
        <img
          v-if="!isCallActive"
          class="kiosk-poster"
          :src="heroPoster"
          alt="NavTalk digital receptionist"
        />
      </div>

      <div class="frame-dial" :style="dialStyle" />
      
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
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useNavTalkRealtime } from './composables/useNavTalkRealtime'

const ORIGINAL_WIDTH = 4096
const ORIGINAL_HEIGHT = 2300
const FRAME_BOUNDS = { x: 1910, y: 857, width: 320, height: 598 }
const DIAL_RATIO = { cx: 0.5, cy: 0.86, size: 0.32 }
const HINT_RATIO = { width: 1, height: 0.08, gap: 0.3, minHeight: 32 }

const videoRef = ref<HTMLVideoElement | null>(null)
const sceneRef = ref<HTMLDivElement | null>(null)
const heroPoster = '/images/avter.png'
const backgroundImage = '/images/lobby-bg.png'

const { isCallActive, isConnecting, toggleSession } = useNavTalkRealtime(videoRef)

const frameStyle = ref<Record<string, string>>({})
const hintStyle = ref<Record<string, string>>({})
const dialStyle = ref<Record<string, string>>({})

const socialLinks = [
  { label: 'YouTube', url: 'https://www.youtube.com/@frankfu007' },
  { label: 'Discord', url: 'https://discord.com/invite/A9VE3zXM9p' },
  { label: 'X', url: 'https://x.com/NavTalkAI' },
  { label: 'Facebook', url: 'https://facebook.com/' },
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
  return { scale, offsetX, offsetY }
}

function updateOverlayPositions() {
  const scene = sceneRef.value
  if (!scene) return
  const rect = scene.getBoundingClientRect()
  const { scale, offsetX, offsetY } = computeCoverLayout(rect)

  const frameWidth = FRAME_BOUNDS.width * scale
  const frameHeight = FRAME_BOUNDS.height * scale
  const frameX = offsetX + FRAME_BOUNDS.x * scale
  const frameY = offsetY + FRAME_BOUNDS.y * scale

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
  hintStyle.value = {
    width: `${hintWidth}px`,
    height: `${hintHeight}px`,
    transform: `translate(${frameX + frameWidth / 2 - hintWidth / 2}px, ${
      frameY + frameHeight + frameHeight * HINT_RATIO.gap
    }px)`,
    fontSize: `${hintHeight * 0.35}px`,
  }
}

let resizeObserver: ResizeObserver | null = null

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
  toggleSession()
}

function openGithub() {
  window.open('https://github.com/navtalk-ai', '_blank')
}
</script>
