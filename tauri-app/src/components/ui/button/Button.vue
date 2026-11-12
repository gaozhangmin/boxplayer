<script setup lang="ts">
import { Primitive, type PrimitiveProps } from 'reka-ui'
import { cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

interface Props extends PrimitiveProps { variant?: 'default' | 'outline' | 'ghost'; size?: 'default' | 'icon'; class?: string }
const props = withDefaults(defineProps<Props>(), { as: 'button', variant: 'default', size: 'default' })
const variants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45', {
  variants: { variant: { default: 'bg-primary text-primary-foreground hover:opacity-90', outline: 'border border-border bg-background hover:bg-muted', ghost: 'hover:bg-muted' }, size: { default: 'h-9 px-4 py-2', icon: 'size-9 p-0' } }
})
</script>
<template><Primitive :as="as" :as-child="asChild" :class="cn(variants({ variant, size }), props.class)"><slot /></Primitive></template>
