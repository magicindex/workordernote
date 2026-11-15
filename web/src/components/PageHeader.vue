<template>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="page-on-bg text-xl font-display font-bold text-foreground">{{ title }}</h1>
      <p v-if="description" class="page-on-bg-muted text-sm text-muted-foreground mt-1">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description?: string
  }>(),
  { description: '' },
)
</script>
