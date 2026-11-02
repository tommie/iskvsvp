<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Collapse from 'bootstrap/js/dist/collapse'

/**
 * A card whose body folds away behind its header, on Bootstrap's own collapse.
 *
 * The plugin is imported here rather than pulled in globally as
 * `bootstrap.bundle.min.js`: this is the only thing on the page that needs it,
 * the single module is a fraction of the bundle, and constructing it explicitly
 * means it works wherever the component is mounted — including a test, which a
 * global `data-bs-toggle` wiring in `main.ts` would not reach.
 *
 * `open` is a model rather than internal state because a card may need to know.
 * The sensitivity grid computes only while it is open, and closing it has to
 * stop the work rather than merely hide it, so it tracks `show`/`hide` — which
 * fire when the animation starts — rather than `shown`/`hidden`, which fire
 * when it ends.
 */
defineProps<{
  title: string
  /** Ties the button to the region it discloses. Unique per page. */
  bodyId: string
}>()

const open = defineModel<boolean>('open', { default: false })

const body = ref<HTMLElement | null>(null)
let collapse: Collapse | null = null

function onShow() {
  open.value = true
}
function onHide() {
  open.value = false
}

onMounted(() => {
  if (!body.value) return
  // `toggle: false` so constructing it does not immediately open the card.
  collapse = new Collapse(body.value, { toggle: false })
  body.value.addEventListener('show.bs.collapse', onShow)
  body.value.addEventListener('hide.bs.collapse', onHide)
  if (open.value) collapse.show()
})

onBeforeUnmount(() => {
  body.value?.removeEventListener('show.bs.collapse', onShow)
  body.value?.removeEventListener('hide.bs.collapse', onHide)
  collapse?.dispose()
  collapse = null
})

// Keeps the plugin in step when the model is set from outside. The handlers
// above write the same value back, which Bootstrap ignores as a no-op because
// it checks its own state before transitioning.
watch(open, (value) => {
  if (!collapse) return
  if (value) collapse.show()
  else collapse.hide()
})
</script>

<template>
  <div class="card">
    <div class="card-header d-flex justify-content-between align-items-center flex-wrap gap-3">
      <button
        type="button"
        class="btn btn-link p-0 text-reset text-decoration-none d-flex align-items-center gap-2"
        :aria-expanded="open"
        :aria-controls="bodyId"
        @click="open = !open"
      >
        <!-- Turned rather than swapped for a second glyph, so the two states
             cannot drift apart. -->
        <span class="chevron" :class="{ open }" aria-hidden="true">›</span>
        {{ title }}
      </button>
      <!-- Controls that belong to the card as a whole rather than to its
           contents, shown only when there are contents for them to act on. -->
      <slot v-if="open" name="header" />
    </div>
    <div :id="bodyId" ref="body" class="collapse">
      <div class="card-body">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.chevron {
  display: inline-block;
  font-size: 1.1em;
  line-height: 1;
  transition: transform 0.15s ease-in-out;
}

.chevron.open {
  transform: rotate(90deg);
}
</style>
