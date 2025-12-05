<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

interface Props {
  renderChart: (svg: SVGSVGElement, container: HTMLDivElement) => void
  data: any
}

const props = defineProps<Props>()

const svgRef = ref<SVGSVGElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isVisible = ref(false)
const lastSize = ref({ width: 0, height: 0 })
const dataDirty = ref(true) // Start as dirty to render on mount
const rafId = ref<number | null>(null)
const timeoutId = ref<number | null>(null)

const maybeRender = () => {
  if (!svgRef.value || !containerRef.value) return

  const container = containerRef.value
  const width = container.clientWidth
  const height = container.clientHeight

  // If size is zero but element is visible, schedule a recheck
  if (width === 0 || height === 0) {
    if (isVisible.value && dataDirty.value && rafId.value === null) {
      rafId.value = requestAnimationFrame(maybeRender)

      timeoutId.value = window.setTimeout(() => {
        timeoutId.value = null
        if (rafId.value !== null) {
          cancelAnimationFrame(rafId.value)
          rafId.value = null
        }
      }, 10000)
    }

    return
  }

  if (!isVisible.value) return

  // Check if we need to render (size changed or data dirty)
  const sizeChanged = width !== lastSize.value.width || height !== lastSize.value.height
  const needsRender = sizeChanged || dataDirty.value

  if (needsRender) {
    lastSize.value = { width, height }
    dataDirty.value = false
    props.renderChart(svgRef.value, container)

    // Clear any pending RAF or timeout
    if (rafId.value !== null) {
      cancelAnimationFrame(rafId.value)
      rafId.value = null
    }
    if (timeoutId.value !== null) {
      clearTimeout(timeoutId.value)
      timeoutId.value = null
    }
  }
}

// Watch for visibility changes
let intersectionObserver: IntersectionObserver | null = null

onMounted(() => {
  if (!containerRef.value) throw new Error()

  // Set up intersection observer to track visibility
  intersectionObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const wasVisible = isVisible.value
        isVisible.value = entry.isIntersecting

        // If becoming visible, try to render
        if (!wasVisible && isVisible.value) {
          maybeRender()
        }
      })
    },
    { threshold: 0.01 },
  )

  intersectionObserver.observe(containerRef.value)

  // Handle window resize
  const handleResize = () => {
    maybeRender()
  }

  window.addEventListener('resize', handleResize)

  // Initial render attempt only if visible
  if (isVisible.value) {
    maybeRender()
  }

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
    if (intersectionObserver) {
      intersectionObserver.disconnect()
    }
    if (rafId.value !== null) {
      cancelAnimationFrame(rafId.value)
    }
    if (timeoutId.value !== null) {
      clearTimeout(timeoutId.value)
    }
  })
})

// Watch for data changes - mark as dirty and render if visible
watch(
  () => props.data,
  () => {
    dataDirty.value = true
    maybeRender()
  },
  { deep: true },
)
</script>

<template>
  <div ref="containerRef" class="chart-container">
    <svg ref="svgRef"></svg>
  </div>
</template>

<style scoped>
.chart-container {
  width: 100%;
  overflow-x: auto;
}

svg {
  display: block;
  margin: 0 auto;
}
</style>
