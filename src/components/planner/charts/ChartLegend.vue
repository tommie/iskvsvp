<script setup lang="ts">
import type { LegendEntry } from './shared'

/**
 * The swatch-and-label strip under a chart.
 *
 * One component rather than the markup repeated per chart, because the markup
 * alone is not enough: a swatch is drawn entirely by CSS, and Vue scopes styles
 * to the component that declares them. Markup and rules therefore have to live
 * in the same file or the swatches render as empty gaps — a failure that is
 * plain to a reader and invisible to a test comparing labels. Keeping both here
 * makes them impossible to separate.
 */
defineProps<{ entries: LegendEntry[] }>()
</script>

<template>
  <div class="legend d-flex flex-wrap gap-3 small text-muted mt-2">
    <span v-for="entry in entries" :key="entry.label" class="item">
      <span
        class="swatch"
        :class="entry.kind ?? 'line'"
        :style="entry.color ? { '--line-color': entry.color } : undefined"
      ></span>
      {{ entry.label }}
    </span>
  </div>
</template>

<style scoped>
.item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

/* The series colour arrives as a custom property rather than as an inline
   background, so the patterned variants can paint with it too: an inline
   background shorthand would win over any stylesheet rule and flatten the
   dashes back to a solid bar. Unset for a neutral swatch, which is what the
   reference marks use. */
.swatch {
  --line-color: var(--bs-secondary-color);
  display: inline-block;
  width: 1.5rem;
  height: 3px;
  background-color: var(--line-color);
}

/* Same 6-on, 4-off rhythm as the stroke-dasharray the charts draw with, and
   likewise 3-on-3 for the dotted reference lines. */
.swatch.dashed {
  background-color: transparent;
  background-image: repeating-linear-gradient(90deg, var(--line-color) 0 6px, transparent 6px 10px);
}

.swatch.dotted {
  background-color: transparent;
  background-image: repeating-linear-gradient(90deg, var(--line-color) 0 3px, transparent 3px 6px);
}

/* A filled area rather than a line, at the opacity it is drawn with. */
.swatch.band {
  height: 0.6rem;
  opacity: 0.18;
}

.swatch.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
}
</style>
